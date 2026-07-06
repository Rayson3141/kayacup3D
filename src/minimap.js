// minimap.js — a compact top-down map shown in the corner of the 3D view.
//
// A stripped-down 2D render: the disk, the recovery band, one dot per living
// fighter colored by HP, a white ring around the player, and the two NPCs.
// DPR-aware so it stays crisp at its small size.

import { LOW_HP } from "./config.js";

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.images = new Map();
    this._resize();
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => this._resize()).observe(canvas);
    }
  }

  show(on) {
    this.canvas.style.display = on ? "block" : "none";
    if (on) this._resize();
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const s = Math.max(1, Math.round(Math.min(rect.width, rect.height) * dpr));
    if (this.canvas.width !== s) { this.canvas.width = s; this.canvas.height = s; }
    this.dpr = dpr;
    this.size = s / dpr;
  }

  _image(src) {
    if (!src) return null;
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.src = src;
      this.images.set(src, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  hpColor(hp) {
    if (hp <= 0) return "#3a3f4b";
    if (hp <= LOW_HP) return "#ff4560";
    if (hp <= 60) return "#ffb020";
    return "#00e07f";
  }

  render(sim, cone = null) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const s = this.size;
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2, cy = s / 2, R = s * 0.46;

    // Disk + rings.
    ctx.fillStyle = "rgba(10,13,20,0.82)";
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(0,212,255,0.7)";
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,255,136,0.45)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(cx, cy, R * (1 - sim.params.rPrime), 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // Camera viewing cone from the player's dot (drawn under the dots).
    if (cone) {
      const px = cx + cone.x * R, py = cy + cone.y * R;
      const len = R * 0.55;
      const base = Math.atan2(cone.fy, cone.fx); // canvas angle (x right, y down)
      const a1 = base - cone.half, a2 = base + cone.half;
      const grad = ctx.createRadialGradient(px, py, 0, px, py, len);
      grad.addColorStop(0, "rgba(0,212,255,0.32)");
      grad.addColorStop(1, "rgba(0,212,255,0)");
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, len, a1, a2);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,212,255,0.55)"; ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Fighters.
    for (const c of sim.contestants) {
      if (c.hp <= 0) continue;
      const x = cx + c.x * R, y = cy + c.y * R;
      if (c.controlled) {
        ctx.lineWidth = 1.5; ctx.strokeStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = this.hpColor(c.hp);
      ctx.beginPath(); ctx.arc(x, y, c.controlled ? 3.2 : 2.6, 0, Math.PI * 2); ctx.fill();
    }

    // NPCs — a tiny Kaya photo if loaded, else emoji; Butter emoji.
    for (const npc of sim.npcs) {
      const x = cx + npc.x * R, y = cy + npc.y * R;
      const img = this._image(npc.image);
      if (img) {
        const d = 14;
        ctx.drawImage(img, x - d / 2, y - d / 2, d, d);
      } else {
        ctx.font = "10px sans-serif";
        ctx.fillText(npc.emoji, x - 5, y + 4);
      }
    }
  }
}
