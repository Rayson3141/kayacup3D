// fx.js — ephemeral visual effects as pure data, shared by both renderers.
//
// update() rebuilds the arrays with filter() so nothing is ever skipped, and
// both the 2D and 3D renderers consume the same effect list.

import { EV } from "./config.js";

export class Fx {
  constructor() {
    this.floaters = []; // { x, y, text, color, life, maxLife, vy }
    this.ripples = [];  // { x, y, radius, maxRadius, alpha }
    this.shake = 0;     // remaining shake intensity (frames)
  }

  clear() {
    this.floaters.length = 0;
    this.ripples.length = 0;
    this.shake = 0;
  }

  floatText(x, y, text, color) {
    this.floaters.push({ x, y, text, color, life: 1, maxLife: 1, vy: 0.18 });
  }

  ripple(x, y, maxRadius, color = "#ff3366") {
    this.ripples.push({ x, y, radius: 0.01, maxRadius, alpha: 0.85, color });
  }

  kick(intensity = 14) {
    this.shake = Math.max(this.shake, intensity);
  }

  // Translate engine events into effects. Keeps renderers free of game logic.
  ingest(events) {
    for (const e of events) {
      switch (e.type) {
        case EV.DAMAGE:
          this.floatText(e.x, e.y, `-${e.amount}`, e.kind === "npc" ? "#ff6666" : "#ff3b3b");
          this.ripple(e.x, e.y, 0.16, e.kind === "npc" ? "#ff8844" : "#ff3366");
          break;
        case EV.HEAL:
          this.floatText(e.x, e.y, "+1", "#88ffaa");
          break;
        case EV.RECOVER:
          this.floatText(e.x, e.y, "+1", "#00ff88");
          break;
        case EV.ELIMINATE:
          this.kick(16);
          this.ripple(e.x, e.y, 0.35, "#ff4560");
          break;
        case EV.FIRST_BLOOD:
          this.kick(20);
          break;
      }
    }
  }

  // Advance effect lifetimes. dtFrames ~= elapsed/16ms so motion is smooth at
  // any frame rate. Uses filter() so no effect is ever skipped.
  update(dtFrames = 1) {
    this.ripples = this.ripples.filter((r) => {
      r.radius += 0.05 * dtFrames;
      r.alpha -= 0.04 * dtFrames;
      return r.alpha > 0 && r.radius < r.maxRadius;
    });
    this.floaters = this.floaters.filter((f) => {
      f.y -= f.vy * 0.02 * dtFrames;
      f.life -= 0.02 * dtFrames;
      return f.life > 0;
    });
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dtFrames);
  }
}
