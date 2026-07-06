// main.js — wires the modules together and runs the game loop.
//
// New responsibilities in this version: dynamically load strategies/<Name>.js
// files (same interface as the repo) and hand them to the engine; map player
// intent to a drift velocity per view (there is no attack); drive the HUD
// (player health bar + red vignette) and the minimap shown in the 3D view.

import { DEFAULT_PARAMS, DT, VIEW, MODE } from "./config.js";
import { Simulation } from "./engine.js";
import { Fx } from "./fx.js";
import { Renderer2D } from "./renderer2d.js";
import { Renderer3D } from "./renderer3d.js";
import { Minimap } from "./minimap.js";
import { ChartPanel } from "./chartPanel.js";
import { Input } from "./input.js";
import { UI } from "./ui.js";

const MAX_CATCHUP_MS = 250; // never simulate more than this much real time per frame

// Load strategies/<Name>.js for every roster name. Missing files are fine —
// those fighters just drift on pure Brownian motion. The interface matches
// the repo's SampleStrategy.js exactly.
async function loadStrategies(names) {
  const map = new Map();
  await Promise.allSettled(names.map(async (name) => {
    try {
      const mod = await import(`../strategies/${name}.js`);
      const fn = mod.default || mod;
      if (typeof fn === "function") map.set(name, fn);
    } catch {
      /* no strategy for this fighter — that's allowed */
    }
  }));
  return map;
}

class Game {
  constructor() {
    this.params = { ...DEFAULT_PARAMS };
    this.seed = "kaya";
    this.view = VIEW.THREE_D;
    this.mode = MODE.SPECTATE;
    this.controlledIndex = 0;

    this.running = false;
    this.holdUntil = 0;
    this.lastTime = 0;
    this.acc = 0;
    this._resetToken = 0;

    this.fx = new Fx();
    this.sim = new Simulation(this.params, this.seed);

    this.r2d = new Renderer2D(document.getElementById("arena2d"));
    this.r3d = new Renderer3D(document.getElementById("arena3d"));
    this.minimap = new Minimap(document.getElementById("minimap"));
    this.chart = new ChartPanel(document.getElementById("hpChart"));
    this.input = new Input();
    this.input.attachJoystick(
      document.getElementById("joystick-base"),
      document.getElementById("joystick-knob"),
    );

    this.ui = new UI({
      onParam: (k, v) => this._onParam(k, v),
      onStart: () => this._toggleRun(),
      onReset: () => this.reset(),
      onView: (v) => this._setView(v),
      onMode: (m) => this._setMode(m),
      onPlayer: (i) => { this.controlledIndex = i; if (!this.running) this.reset(); },
      onSeed: (s) => { this.seed = s || "kaya"; this.reset(); },
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.lastTime = performance.now(); // avoid catch-up spike
    });

    this._applyViewMode();
    this.reset();
    requestAnimationFrame((t) => this._loop(t));
  }

  _onParam(key, value) {
    this.params[key] = value;
    if (key === "qty" && !this.running) this.reset();
  }

  _setView(v) {
    this.view = v;
    this._applyViewMode();
  }

  _setMode(m) {
    this.mode = m;
    this._applyViewMode();
    this.reset(); // switching spectate <-> play rebuilds with/without a human fighter
  }

  _applyViewMode() {
    this.r2d.show(this.view === VIEW.TWO_D);
    this.r3d.show(this.view === VIEW.THREE_D);
    // The minimap exists precisely for when the top-down view is NOT active.
    this.minimap.show(this.view !== VIEW.TWO_D);
    const playing = this.mode === MODE.PLAY;
    this.ui.showPlayerRow(playing);
    this.ui.showMobile(playing);
    this.ui.showHud(playing);
    this.input.setEnabled(playing && this.running);
  }

  reset() {
    this.running = false;
    this.holdUntil = 0;
    this.acc = 0;
    this.ui.clearOverlay();
    this.ui.setRunning(false);
    this.fx.clear();

    const controlled = this.mode === MODE.PLAY ? this.controlledIndex : null;
    this.sim.reset(this.params, this.seed, controlled);
    this.r3d.build(this.sim);
    this.chart.reset(this.sim);
    this.ui.fillPlayers(this.sim);
    if (this.mode === MODE.PLAY) document.getElementById("player-select").value = String(this.controlledIndex);

    // Load strategy files for the current roster. Token guards against a
    // stale load finishing after a newer reset.
    const token = ++this._resetToken;
    loadStrategies(this.sim.contestants.map((c) => c.name)).then((map) => {
      if (token !== this._resetToken) return;
      this.sim.setStrategies(map);
      this.ui.leaderboard(this.sim);
      const n = map.size;
      if (n > 0) this.ui.log(`🧠 ${n} strategy file${n > 1 ? "s" : ""} loaded.`, "#00d4ff");
    });

    this.ui.start("⚔️ Fighters dropped. Kaya 🐱 and Butter 🐶 roam the arena.");
    this.ui.setTimer(0);
    this.ui.leaderboard(this.sim);
    this.ui.hud(this.sim.player);
    this.input.setEnabled(false);
    this._renderOnce();
  }

  _toggleRun() {
    if (this.sim.over) this.reset();
    this.running = !this.running;
    this.ui.setRunning(this.running);
    this.input.setEnabled(this.mode === MODE.PLAY && this.running);
    if (this.running) {
      this.lastTime = performance.now();
      this.acc = 0;
      if (this.sim.time === 0) {
        this.holdUntil = performance.now() + 3100;
        this.ui.countdown();
      }
    } else {
      this.ui.clearOverlay();
    }
  }

  // Convert keyboard/joystick intent into a world-space drift for the engine.
  //   3D view: WASD is CAMERA-RELATIVE — W drives the fighter in the direction
  //            the camera faces, A/D strafe relative to the view, so movement
  //            follows wherever the arrow keys have aimed the camera.
  //   2D view: WASD is world-absolute (W = up on the top-down map).
  _playerInput() {
    if (this.mode !== MODE.PLAY) return null;
    const fwd = this.input.fwd, strafe = this.input.strafe;
    let mx, my;
    if (this.view === VIEW.THREE_D) {
      const b = this.r3d.groundBasis();
      mx = b.right.x * strafe + b.fwd.x * fwd;
      my = b.right.y * strafe + b.fwd.y * fwd;
    } else {
      mx = strafe; my = -fwd;
    }
    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }
    return { move: { x: mx, y: my } };
  }

  _loop(now) {
    const dtFrames = Math.min(3, (now - (this._prevFrame || now)) / 16.67);
    this._prevFrame = now;

    // Arrow keys orbit/tilt the 3D camera (independent of WASD movement).
    if (this.mode === MODE.PLAY && this.view === VIEW.THREE_D) {
      this.r3d.orbit(this.input.camYaw, this.input.camPitch, dtFrames);
    }

    if (this.running && now >= this.holdUntil) {
      let elapsed = now - this.lastTime;
      if (elapsed > MAX_CATCHUP_MS) elapsed = MAX_CATCHUP_MS; // clamp tab-return spike
      this.lastTime = now;
      this.acc += elapsed;
      const stepMs = (DT * 1000) / this.params.speed;

      let firstBlood = false, ended = false;
      while (this.acc >= stepMs && !ended) {
        const input = this._playerInput();
        const events = this.sim.step(input);
        this.acc -= stepMs;
        this.fx.ingest(events);
        this.ui.consume(events, this.sim.time);
        for (const e of events) {
          if (e.type === "first_blood") { firstBlood = true; this.ui.alert("🩸 FIRST BLOOD", e.victim ? `${e.victim} is out` : ""); }
          if (e.type === "eliminate" && this.mode === MODE.PLAY && this.sim.player && e.victimId === this.sim.player.id)
            this.ui.alert("YOU ARE OUT", e.killer ? `Eliminated by ${e.killer}` : "", 2200);
          if (e.type === "champion") { ended = true; this.ui.alert("🏆 CHAMPION", `${e.name} wins the Kaya Cup`, 3000); }
          if (e.type === "draw") { ended = true; this.ui.alert("☠️ NO SURVIVORS", "", 3000); }
        }
        if (firstBlood) { this.holdUntil = now + 1400; this.acc = 0; break; }
      }

      this.ui.setTimer(this.sim.time);
      this.ui.leaderboard(this.sim);
      if (this.mode === MODE.PLAY) this.ui.hud(this.sim.player);
      this.chart.sample(this.sim);

      if (ended || this.sim.over) {
        this.running = false;
        this.ui.setRunning(false);
        this.input.setEnabled(false);
      }
    }

    this.fx.update(dtFrames);
    this._renderOnce();
    requestAnimationFrame((t) => this._loop(t));
  }

  _renderOnce() {
    const opts = { mode: this.mode };
    if (this.view === VIEW.THREE_D) {
      this.r3d.render(this.sim, this.fx, opts);
      // In play mode, tell the minimap where the camera is looking so it can
      // draw a viewing cone from the player's dot.
      let cone = null;
      const p = this.sim.player;
      if (this.mode === MODE.PLAY && p && p.hp > 0) {
        const b = this.r3d.groundBasis();
        cone = { x: p.x, y: p.y, fx: b.fwd.x, fy: b.fwd.y, half: this.r3d.halfFovH() };
      }
      this.minimap.render(this.sim, cone);
    } else {
      this.r2d.render(this.sim, this.fx, opts);
    }
  }
}

window.addEventListener("DOMContentLoaded", () => new Game());
