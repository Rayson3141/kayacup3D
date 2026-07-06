// config.js — all the tunable constants and shared enums in one place.

// Roster synced with the current KayaCup repo.
export const STUDENT_NAMES = [
  "JAC", "ZSSS", "Tungston", "Lim1555", "RayNA", "QRun", "Hao_T",
  "Leslie", "Fyna", "Poh", "LiY", "CXian", "Bunny", "Ivan", "XCY666",
  "ProfY", "Thorston", "Telur", "Kopi", "Puchong_123",
];

// Fixed simulation timestep (seconds). The loop steps in these increments
// regardless of frame rate, so the physics are frame-rate independent.
export const DT = 0.05;

export const MAX_HP = 100;
export const RECOVERY_CAP = 25;   // boundary recovery can't lift you past this
export const LOW_HP = 25;         // "in distress" threshold

// Movement model: every fighter's step = drift + Brownian diffusion.
//   drift  — a controlled velocity, capped at MAX_DRIFT_SPEED (units/second).
//            AI fighters get it from their strategies/<Name>.js file; the
//            human player gets it from WASD / the joystick. That's ALL the
//            player controls — there is no manual attack.
//   diffusion — the same sigma-scaled Gaussian noise for everyone, player
//            included. Nobody escapes the randomness.
export const MAX_DRIFT_SPEED = 1.2;

// NPC behavior (synced with the current repo):
export const KAYA_ATTACK_RATE = 2.0;  // Kaya strikes ~2x per second in range
export const BUTTER_HEAL_RATE = 1.0;  // Butter heals ~1x per second in range
export const BUTTER_HEAL_CAP = 50;    // Butter only heals fighters below 50 HP

export const DEFAULT_PARAMS = {
  qty: 20,
  speed: 1.0,
  sigma: 0.2,    // diffusion strength
  r: 0.25,       // fight radius
  lam: 5.0,      // Poisson fight rate
  rPrime: 0.15,  // boundary band width for recovery
  beta: 2.0,     // recovery rate
};

export const PARAM_RANGES = {
  qty:    { min: 2,    max: 20, step: 1 },
  speed:  { min: 0.25, max: 3,  step: 0.25 },
  sigma:  { min: 0,    max: 1,  step: 0.05 },
  r:      { min: 0.01, max: 0.5, step: 0.01 },
  lam:    { min: 0.1,  max: 10, step: 0.1 },
  rPrime: { min: 0.01, max: 0.5, step: 0.01 },
  beta:   { min: 0.1,  max: 5,  step: 0.1 },
};

// NPC definitions. NPCs have no HP; they roam and affect fighters.
// Kaya renders as the real cat image (assets/kaya.png); Butter as an emoji.
export const NPC_DEFS = [
  { name: "Kaya",   type: "demon",  emoji: "🐱", color: "#ffaa66", image: "assets/kaya.png" },
  { name: "Butter", type: "healer", emoji: "🐶", color: "#88ccff", image: null },
];

// Engine event types — the engine emits these; renderers/UI react to them.
export const EV = {
  DAMAGE:      "damage",
  HEAL:        "heal",
  RECOVER:     "recover",
  ELIMINATE:   "eliminate",
  FIRST_BLOOD: "first_blood",
  FINAL_THREE: "final_three",
  CHAMPION:    "champion",
  DRAW:        "draw",
};

export const VIEW = { TWO_D: "2d", THREE_D: "3d" };
export const MODE = { SPECTATE: "spectate", PLAY: "play" };
