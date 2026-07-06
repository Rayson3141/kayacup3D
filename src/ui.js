// ui.js — everything that touches the DOM dashboard.
//
// Owns the sliders (in a collapsible coefficients panel), leaderboard (with
// inline HP bars), event ticker, big-text overlay, and the play-mode HUD:
// a player health bar, a red vignette that deepens as the player's HP drops,
// and a faint controls hint. All player-facing wording lives here; the
// engine emits only structured events.

import { PARAM_RANGES, MAX_HP, LOW_HP, EV } from "./config.js";

export class UI {
  constructor(handlers) {
    this.h = handlers;  // { onParam, onStart, onReset, onView, onMode, onPlayer, onSeed }
    this.timers = [];
    this._cacheDom();
    this._bind();
  }

  _cacheDom() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      timer: $("timer"),
      tbody: document.querySelector("#leaderboard tbody"),
      ticker: $("ticker-box"),
      overlayCount: $("overlay-count"),
      alert: $("overlay-alert"),
      alertTitle: $("alert-title"),
      alertSub: $("alert-sub"),
      btnToggle: $("btn-toggle"),
      btnReset: $("btn-reset"),
      seed: $("seed-input"),
      playerSelect: $("player-select"),
      playerRow: $("player-row"),
      mobile: $("mobile-controls"),
      hud: $("player-hud"),
      hudName: $("hud-name"),
      hudHp: $("hud-hp"),
      hudFill: $("hud-fill"),
      vignette: $("vignette"),
      hint: $("controls-hint"),
    };
  }

  _bind() {
    // Sliders.
    for (const key of Object.keys(PARAM_RANGES)) {
      const input = document.getElementById(`param-${key}`);
      const out = document.getElementById(`val-${key}`);
      if (!input) continue;
      const fmt = (v) => key === "speed" ? `${v}x`
        : (PARAM_RANGES[key].step < 1 ? Number(v).toFixed(2) : v);
      input.addEventListener("input", (e) => {
        const v = Number(e.target.value);
        out.textContent = fmt(v);
        this.h.onParam(key, v);
      });
      out.textContent = fmt(Number(input.value));
    }

    this.el.btnToggle.addEventListener("click", () => this.h.onStart());
    this.el.btnReset.addEventListener("click", () => this.h.onReset());
    this.el.seed.addEventListener("change", (e) => this.h.onSeed(e.target.value.trim()));

    document.querySelectorAll("[data-view]").forEach((b) =>
      b.addEventListener("click", () => this.setActive("data-view", b.dataset.view, () => this.h.onView(b.dataset.view))));
    document.querySelectorAll("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => this.setActive("data-mode", b.dataset.mode, () => this.h.onMode(b.dataset.mode))));

    this.el.playerSelect.addEventListener("change", (e) => this.h.onPlayer(Number(e.target.value)));
  }

  setActive(attr, value, cb) {
    document.querySelectorAll(`[${attr}]`).forEach((b) =>
      b.classList.toggle("active", b.getAttribute(attr) === value));
    cb && cb();
  }

  // Populate the "which fighter is you" dropdown.
  fillPlayers(sim) {
    const sel = this.el.playerSelect;
    sel.innerHTML = "";
    sim.contestants.forEach((c, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
  }

  showPlayerRow(on) { this.el.playerRow.style.display = on ? "" : "none"; }
  showMobile(on) { this.el.mobile.style.display = on ? "flex" : "none"; }

  // ---- Play-mode HUD ----
  showHud(on) {
    this.el.hud.style.display = on ? "flex" : "none";
    this.el.hint.style.display = on ? "block" : "none";
    if (!on) this.el.vignette.style.opacity = "0";
  }

  hud(player) {
    if (!player) return;
    const hp = Math.max(0, player.hp);
    this.el.hudName.textContent = player.name;
    this.el.hudHp.textContent = `${hp.toFixed(0)} HP`;
    const frac = hp / MAX_HP;
    this.el.hudFill.style.width = `${frac * 100}%`;
    this.el.hudFill.style.background =
      hp <= LOW_HP ? "#ff4560" : hp <= 60 ? "#ffb020" : "#00e07f";
    // The screen bleeds red as the player weakens: nothing above 70 HP, then
    // ramping toward a heavy vignette near death.
    const danger = Math.max(0, Math.min(1, (70 - hp) / 70));
    this.el.vignette.style.opacity = String(danger * 0.85);
  }

  setRunning(running) {
    this.el.btnToggle.textContent = running ? "⏸  Pause" : "🚀  Start tournament";
    this.el.btnToggle.classList.toggle("running", running);
  }

  setTimer(t) { this.el.timer.textContent = `Tournament time: ${t.toFixed(1)}s`; }

  hpColor(hp) {
    if (hp <= 0) return "#555b66";
    if (hp <= LOW_HP) return "#ff4560";
    if (hp <= 60) return "#ffb020";
    return "#00e07f";
  }

  // Leaderboard rows carry an inline HP bar, so the table doubles as a
  // health readout for the whole field.
  leaderboard(sim) {
    const sorted = sim.leaderboard();
    const frag = document.createDocumentFragment();
    sorted.forEach((c, i) => {
      const tr = document.createElement("tr");
      const td = (txt, style) => { const d = document.createElement("td"); d.textContent = txt; if (style) Object.assign(d.style, style); return d; };
      tr.appendChild(td(String(i + 1)));
      const crown = i === 0 && c.hp > 0 ? " 👑" : "";
      const brain = c.hasStrategy ? " 🧠" : "";
      const you = c.controlled ? " ·you" : "";
      tr.appendChild(td(`${c.name}${brain}${crown}${you}`, { fontWeight: "600", color: c.hp > 0 ? "#e6edf3" : "#555b66" }));

      const hpTd = document.createElement("td");
      hpTd.className = "hp-cell";
      const wrap = document.createElement("div");
      wrap.className = "hp-track";
      const fill = document.createElement("div");
      fill.className = "hp-fill";
      fill.style.width = `${Math.max(0, c.hp)}%`;
      fill.style.background = this.hpColor(c.hp);
      wrap.appendChild(fill);
      const num = document.createElement("span");
      num.textContent = c.hp.toFixed(0);
      num.style.color = this.hpColor(c.hp);
      hpTd.appendChild(wrap);
      hpTd.appendChild(num);
      tr.appendChild(hpTd);

      frag.appendChild(tr);
    });
    this.el.tbody.replaceChildren(frag);
  }

  // ---- Ticker (event flavor text lives here) ----
  log(msg, color = "#c9d1d9") {
    const div = document.createElement("div");
    div.className = "log-entry";
    div.style.color = color;
    div.textContent = msg; // textContent: names can never inject markup
    this.el.ticker.appendChild(div);
    while (this.el.ticker.children.length > 14) this.el.ticker.removeChild(this.el.ticker.firstChild);
    this.el.ticker.scrollTop = this.el.ticker.scrollHeight;
  }

  consume(events, time) {
    for (const e of events) {
      switch (e.type) {
        case EV.FIRST_BLOOD:
          this.log(`🩸 First blood — ${e.victim} is down${e.killer ? `, struck by ${e.killer}` : ""}!`, "#ff3b3b");
          break;
        case EV.ELIMINATE:
          if (e.kind === "npc") this.log(`💀 ${e.killer} the demon cat knocks out ${e.victim}!`, "#ff6b6b");
          else this.log(`💥 ${e.killer} eliminated ${e.victim}!`, "#ff4560");
          break;
        case EV.FINAL_THREE:
          this.log("👑 Down to the wire — three fighters left!", "#ffea00");
          break;
        case EV.CHAMPION:
          this.log(`🏆 ${e.name} is the Kaya Cup champion!`, "#ffea00");
          break;
        case EV.DRAW:
          this.log("☠️ Mutual destruction — no survivors.", "#ff4560");
          break;
      }
    }
  }

  start(msg) { this.el.ticker.innerHTML = ""; this.log(msg, "#00d4ff"); }

  // ---- Overlay (shared by 2D and 3D), all timers cancelable ----
  clearOverlay() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.el.overlayCount.style.display = "none";
    this.el.alert.classList.remove("show");
  }

  countdown(onDone) {
    this.clearOverlay();
    const seq = ["3", "2", "1", "FIGHT!"];
    const node = this.el.overlayCount;
    node.style.display = "flex";
    let i = 0;
    const tick = () => {
      node.textContent = seq[i];
      node.style.color = seq[i] === "FIGHT!" ? "#ff4560" : "#00d4ff";
      node.classList.remove("pop"); void node.offsetWidth; node.classList.add("pop");
      i++;
      if (i < seq.length) this.timers.push(setTimeout(tick, 800));
      else this.timers.push(setTimeout(() => { node.style.display = "none"; onDone && onDone(); }, 700));
    };
    tick();
  }

  alert(title, sub = "", hold = 1600) {
    this.el.alertTitle.textContent = title;
    this.el.alertSub.textContent = sub;
    this.el.alert.classList.add("show");
    const t = setTimeout(() => this.el.alert.classList.remove("show"), hold);
    this.timers.push(t);
  }
}
