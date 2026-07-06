// engine.js — the pure simulation. No DOM, no canvas, no timers.
//
// Movement model (synced with the repo's strategy system): every living
// fighter moves by  drift · dt  +  σ · dW.
//   - The drift is a controlled velocity capped at MAX_DRIFT_SPEED. AI
//     fighters get it from their strategy function (strategies/<Name>.js in
//     the repo); the human player gets it from input. The player has NO
//     manual attack — drift is the only thing anyone controls.
//   - The diffusion term is identical for everyone, including the player.
// Combat, NPC effects, and boundary recovery are all automatic.

import { RNG } from "./rng.js";
import {
  DT, MAX_HP, RECOVERY_CAP, LOW_HP,
  MAX_DRIFT_SPEED, KAYA_ATTACK_RATE, BUTTER_HEAL_RATE, BUTTER_HEAL_CAP,
  STUDENT_NAMES, NPC_DEFS, EV,
} from "./config.js";

let _uid = 0;
const nextId = () => ++_uid;

export class Simulation {
  constructor(params, seed) {
    this.params = { ...params };
    this.strategies = new Map(); // name -> strategy function
    this.reset(params, seed);
  }

  /**
   * Rebuild the world.
   * Start layout is synced with the repo: fighters equi-angled on a circle of
   * radius 0.8, NPCs at the center.
   */
  reset(params, seed, controlledIndex = null) {
    this.params = { ...params };
    this.rng = new RNG(seed);
    this.seed = this.rng.seed;
    this.time = 0;
    this.over = false;
    this.champion = null;
    this.firstBloodDone = false;
    this.finalThreeAnnounced = false;

    const qty = params.qty;
    this.contestants = [];
    for (let i = 0; i < qty; i++) {
      const theta = (i / qty) * 2 * Math.PI;
      this.contestants.push({
        id: nextId(),
        name: STUDENT_NAMES[i] || `Student ${i + 1}`,
        x: 0.8 * Math.cos(theta),
        y: 0.8 * Math.sin(theta),
        hp: MAX_HP,
        controlled: i === controlledIndex,
        hasStrategy: false,
        strategyDisabled: false,
      });
    }
    this.controlledId =
      controlledIndex == null ? null : this.contestants[controlledIndex].id;

    this.npcs = NPC_DEFS.map((def) => ({ id: nextId(), ...def, x: 0, y: 0 }));
    this._markStrategies();
  }

  /** Provide the map of loaded strategy functions (name -> fn). */
  setStrategies(map) {
    this.strategies = map || new Map();
    this._markStrategies();
  }

  _markStrategies() {
    for (const c of this.contestants) {
      c.hasStrategy = !c.controlled && !c.strategyDisabled && this.strategies.has(c.name);
    }
  }

  get player() {
    return this.controlledId == null
      ? null
      : this.contestants.find((c) => c.id === this.controlledId) || null;
  }

  survivors() {
    return this.contestants.filter((c) => c.hp > 0);
  }

  leaderboard() {
    return [...this.contestants].sort((a, b) => b.hp - a.hp);
  }

  // Reflect a position back inside the unit disk instead of clamping it to the
  // rim. Reflection conserves the step length and is more physical.
  _confine(p, nx, ny) {
    const dist = Math.hypot(nx, ny);
    if (dist <= 1) {
      p.x = nx;
      p.y = ny;
      return;
    }
    const over = dist - 1;
    let r = 1 - over;
    if (r < 0) r = 0;
    const k = r / dist;
    p.x = nx * k;
    p.y = ny * k;
  }

  // Build the context object passed to strategy functions. The field names
  // (r_limit, r_prime, ...) intentionally match the repo's documented
  // interface so existing strategies/<Name>.js files keep working unmodified.
  _strategyContext(me) {
    const p = this.params;
    return {
      me: { name: me.name, x: me.x, y: me.y, hp: me.hp },
      others: this.contestants
        .filter((o) => o.id !== me.id && o.hp > 0)
        .map((o) => ({ name: o.name, x: o.x, y: o.y, hp: o.hp })),
      npcs: this.npcs.map((n) => ({
        name: n.name, type: n.type, x: n.x, y: n.y, emoji: n.emoji, hp: Infinity,
      })),
      params: {
        sigma: p.sigma, r_limit: p.r, lam: p.lam,
        r_prime: p.rPrime, beta: p.beta, qty: p.qty, speed: p.speed,
      },
      dt: DT,
      maxSpeed: MAX_DRIFT_SPEED,
    };
  }

  // Resolve a fighter's drift velocity: player input for the controlled
  // fighter, their strategy function for AI. Returns {vx, vy} capped at
  // MAX_DRIFT_SPEED.
  _drift(c, input) {
    let vx = 0, vy = 0;
    if (c.controlled) {
      if (input && input.move) {
        // input.move is an intent vector with magnitude <= 1
        vx = input.move.x * MAX_DRIFT_SPEED;
        vy = input.move.y * MAX_DRIFT_SPEED;
      }
    } else if (c.hasStrategy) {
      const fn = this.strategies.get(c.name);
      if (fn) {
        try {
          const mv = fn(this._strategyContext(c));
          if (mv && typeof mv === "object") {
            vx = typeof mv.dx === "number" && isFinite(mv.dx) ? mv.dx : 0;
            vy = typeof mv.dy === "number" && isFinite(mv.dy) ? mv.dy : 0;
          }
        } catch (err) {
          // A broken strategy shouldn't crash the tournament — bench it.
          console.warn(`Strategy error for ${c.name}:`, err);
          c.strategyDisabled = true;
          c.hasStrategy = false;
        }
      }
    }
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_DRIFT_SPEED) {
      const k = MAX_DRIFT_SPEED / speed;
      vx *= k; vy *= k;
    }
    return { vx, vy };
  }

  /**
   * Advance one fixed timestep.
   * @param {{move:{x:number,y:number}}|null} input  human drift intent
   * @returns {Array<object>} events emitted this step
   */
  step(input = null) {
    if (this.over) return [];
    const events = [];
    const { sigma, r, lam, rPrime, beta } = this.params;
    const stepSize = sigma * Math.sqrt(DT);

    // 1. Movement — drift (strategy or input) + Brownian diffusion for every
    //    living fighter, player included. One shared law of motion.
    for (const c of this.contestants) {
      if (c.hp <= 0) continue;
      const { vx, vy } = this._drift(c, input);
      const nx = c.x + vx * DT + this.rng.gaussian() * stepSize;
      const ny = c.y + vy * DT + this.rng.gaussian() * stepSize;
      this._confine(c, nx, ny);
    }
    for (const npc of this.npcs) {
      this._confine(npc, npc.x + this.rng.gaussian() * stepSize, npc.y + this.rng.gaussian() * stepSize);
    }

    // 2. Autonomous fights — every living pair within r, gated by a Poisson
    //    rate. Winner chosen by HP ratio; loser takes 1 HP.
    const fightProb = 1 - Math.exp(-lam * DT);
    const list = this.contestants;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.hp <= 0) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.hp <= 0) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) >= r) continue;
        if (this.rng.next() >= fightProb) continue;

        const aWins = this.rng.next() < a.hp / (a.hp + b.hp + 1e-9);
        const [winner, loser] = aWins ? [a, b] : [b, a];
        this._damage(loser, 1.0, winner, events, "fight");
        if (loser.hp <= 0) break;
      }
    }

    // 3. NPC abilities — Kaya strikes at her own rate; Butter heals at his,
    //    and only fighters below the 50 HP cap.
    const kayaProb = 1 - Math.exp(-KAYA_ATTACK_RATE * DT);
    const butterProb = 1 - Math.exp(-BUTTER_HEAL_RATE * DT);
    for (const npc of this.npcs) {
      for (const c of this.contestants) {
        if (c.hp <= 0) continue;
        if (Math.hypot(c.x - npc.x, c.y - npc.y) >= r) continue;
        if (npc.type === "demon") {
          if (this.rng.next() < kayaProb) this._damage(c, 1.0, npc, events, "npc");
        } else if (npc.type === "healer") {
          if (c.hp < BUTTER_HEAL_CAP && this.rng.next() < butterProb) {
            c.hp = Math.min(BUTTER_HEAL_CAP, c.hp + 1.0);
            events.push({ type: EV.HEAL, x: c.x, y: c.y, targetId: c.id, by: npc.name });
          }
        }
      }
    }

    // 4. Boundary recovery — fighters at low HP sitting near the rim slowly
    //    recover, capped at RECOVERY_CAP.
    const recoverProb = 1 - Math.exp(-beta * DT);
    const band = 1 - rPrime;
    for (const c of this.contestants) {
      if (c.hp <= 0 || c.hp > LOW_HP) continue;
      if (Math.hypot(c.x, c.y) < band) continue;
      if (this.rng.next() >= recoverProb) continue;
      c.hp = Math.min(RECOVERY_CAP, c.hp + 1.0);
      events.push({ type: EV.RECOVER, x: c.x, y: c.y, targetId: c.id });
    }

    // 5. Advance clock and check for end of tournament.
    this.time = Math.round((this.time + DT) * 100) / 100;
    const alive = this.survivors();
    if (!this.finalThreeAnnounced && alive.length === 3) {
      this.finalThreeAnnounced = true;
      events.push({ type: EV.FINAL_THREE });
    }
    if (alive.length <= 1) {
      this.over = true;
      if (alive.length === 1) {
        this.champion = alive[0];
        events.push({ type: EV.CHAMPION, name: alive[0].name, id: alive[0].id });
      } else {
        events.push({ type: EV.DRAW });
      }
    }
    return events;
  }

  // The single source of truth for dealing damage and eliminations.
  _damage(target, amount, source, events, kind) {
    const wasAlive = target.hp > 0;
    target.hp = Math.max(0, target.hp - amount);
    events.push({
      type: EV.DAMAGE,
      x: target.x, y: target.y,
      targetId: target.id,
      amount,
      kind,
      sourceName: source && source.name,
    });
    if (wasAlive && target.hp <= 0) {
      events.push({
        type: EV.ELIMINATE,
        x: target.x, y: target.y,
        victimId: target.id,
        victim: target.name,
        killer: source && source.name,
        kind,
      });
      if (!this.firstBloodDone) {
        this.firstBloodDone = true;
        events.push({ type: EV.FIRST_BLOOD, victim: target.name, killer: source && source.name, kind });
      }
    }
  }
}
