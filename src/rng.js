// rng.js — a small, seedable pseudo-random generator.
//
// The original simulation used Math.random() everywhere, so no two runs could
// ever be reproduced or shared. This wraps mulberry32 (a fast, decent 32-bit
// PRNG) so a given seed always replays the exact same autonomous tournament.

export class RNG {
  /** @param {number|string} seed */
  constructor(seed = Date.now()) {
    this.reseed(seed);
  }

  reseed(seed) {
    // Accept strings (e.g. a shareable seed like "kaya") by hashing them.
    if (typeof seed === "string") seed = RNG.hashString(seed);
    this.seed = seed >>> 0;
    this._state = this.seed;
    this._spare = null; // cached value for the Box–Muller transform
  }

  /** Uniform float in [0, 1). */
  next() {
    let t = (this._state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min, max) {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max]. */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** Pick a random element from an array. */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Standard normal sample via Box–Muller (caches the second value). */
  gaussian() {
    if (this._spare !== null) {
      const v = this._spare;
      this._spare = null;
      return v;
    }
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    this._spare = mag * Math.sin(2.0 * Math.PI * v);
    return mag * Math.cos(2.0 * Math.PI * v);
  }

  static hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
}
