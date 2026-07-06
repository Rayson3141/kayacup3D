/**
 * ============================================================================
 *  KAYA CUP 2026 — "Mean-Field Gradient Flow" strategy
 * ============================================================================
 *
 *  DESIGN IN ONE LINE
 *  ------------------
 *  Treat my velocity as PROJECTED GRADIENT FLOW on a scalar energy landscape:
 *
 *          v(z)  =  Π_{|v| ≤ maxSpeed} ( − ∇E(z) )
 *
 *  where z = (x, y) is my position and E is an energy that I derive, term by
 *  term, from the exact game mechanics. Moving down −∇E is steepest descent of
 *  "expected danger" and steepest ascent of "expected health flux + strategic
 *  value". Each context variable enters through the term it physically governs.
 *
 *  WHY NOT "GUARANTEE" A WIN?
 *  --------------------------
 *  The dynamics are a controlled SDE:  dz = v·dt + σ·dW.  Fights are Bernoulli
 *  with p = HP_i/(HP_i+HP_j), Kaya/Butter fire as Poisson processes, and the
 *  diffusion term σ·dW is beyond any controller's authority (per step the
 *  diffusion std σ√Δt ≈ 0.045 is comparable to the max control step
 *  maxSpeed·Δt = 0.06). Hence every policy has strictly positive probability of
 *  elimination — no determinism is possible. This strategy instead MAXIMISES
 *  WIN PROBABILITY, and the choices below are each argued from the model.
 *
 *  THE ENERGY  E = E_safe + E_value + E_home
 *  ------------------------------------------
 *  Written as forces F = −∇E (each term is the negative gradient of a radial
 *  potential, so summing forces IS gradient flow):
 *
 *  1. KAYA  (−∇ of a Gaussian danger well).  Kaya removes HP at Poisson rate
 *     λ_K = 2 within r_limit, so the myopic HP-loss field is −λ_K·1[r_K<r_limit].
 *     I smooth the indicator into a Gaussian kernel and push UP its gradient
 *     (away). The weight carries a marginal-value-of-HP factor φ(HP) that grows
 *     as HP→0: near death, avoiding 1 HP of damage is worth far more, because
 *     the value function V(HP) of survival is convex near 0 (V'(HP) large).
 *
 *  2. FIGHTS  (signed, from the win law).  For opponent j the expected change
 *     of MY hp per fight is  −HP_j/(HP_i+HP_j)  and of THEIR hp is
 *     −HP_i/(HP_i+HP_j). The *relative* HP advantage rate is therefore
 *
 *           s_j = (HP_i − HP_j)/(HP_i + HP_j)  ∈ (−1, 1).
 *
 *     This is the natural potential coefficient: s_j>0 (I'm stronger) ⇒ attract
 *     (a favourable duel drains them faster than me); s_j<0 ⇒ repel (flee the
 *     stronger). Scaled by the fight rate λ (params.lam): faster fights ⇒ more
 *     urgent. Attraction is gated by safety (see g_* below); repulsion is never
 *     gated — running from the strong is always correct.
 *
 *  3. CROWD / MEAN FIELD.  Model the others by their empirical measure
 *     μ_N = (1/N)Σ δ_{z_j}. A short-range repulsive convolution (W * μ_N)(z)
 *     with per-capita 1/N scaling keeps me out of dense clusters, where
 *     multiple simultaneous duels create ruinous HP variance and gang-ups.
 *
 *  4. BUTTER  (conditional attractor).  Butter heals at rate λ_B = 1 within
 *     r_limit but only while HP < 50. So the attraction switches on with weight
 *     ∝ (50 − HP)_+ , i.e. exactly the healable deficit, and vanishes at HP≥50.
 *
 *  5. BORDER RECOVERY + HOME ANNULUS  (radial control).  Border recovery adds
 *     +β for HP≤25 at radius ≥ 1−r'. I keep a soft radial target r_target that
 *     sits just inside the recovery band; when HP is low I push r_target into
 *     the band (commit to healing) with strength ∝ β and the HP deficit. A
 *     healthy "home" radius near the boundary minimises neighbour count (less
 *     area ⇒ fewer passers-by ⇒ fewer fights) — a Lyapunov-stable camp.
 *
 *  6. WALL.  A soft inward push as r→1 stops me being clamped/pinned to the
 *     rim (predictable and wasteful of control authority).
 *
 *  DIFFUSION σ AS ANTICIPATION (Hamilton–Jacobi–Bellman intuition).
 *  The value function of the controlled SDE solves an HJB equation whose second
 *  order term is (σ²/2)ΔV. To first order this convolves every potential with a
 *  heat kernel of variance ∝ σ²·horizon, i.e. it BLURS danger outward by the
 *  diffusion length. I implement this by inflating every interaction length
 *  scale:   ℓ = sqrt(r_limit² + (σ√Δt · √τ)²).   So I start dodging Kaya / the
 *  strong BEFORE contact, because diffusion could shove me in. (Uses σ, Δt.)
 *
 *  FINITE-HORIZON AGGRESSION SCHEDULE (uses N and the live count).
 *  Early, with many alive, others thin themselves out for free, so the value
 *  term is down-weighted (camp, stay at 100 HP). As the field shrinks the
 *  expected number of "free" future deaths → 0, so the strategic weight g_end
 *  → 1 and I switch to actively hunting the weakest remaining. This is the
 *  finite-horizon correction to the myopic (pacifist) HP-flux optimum.
 *
 *  Return: {dx, dy} in units/sec, magnitude ≤ maxSpeed (auto-capped anyway).
 * ============================================================================
 */

// Mechanics fixed by the assignment spec (not exposed in params):
const KAYA_RATE   = 2.0;  // Kaya damage events / sec
const BUTTER_RATE = 1.0;  // Butter heal events / sec
const HEAL_CAP    = 50;   // Butter only heals below this HP
const RECOVER_HP  = 25;   // border recovery threshold & cap

let _tick = 0; // for optional throttled debug logging

export default function (context) {
  const { me, others, npcs, params, dt, maxSpeed } = context;
  const { sigma, r_limit, lam, r_prime, beta, qty, speed } = params;

  // ---- weights (tuned by headless tournament simulation) -------------------
  const W = {
    kaya: 1.55, kayaVuln: 2.2,
    butter: 1.15,
    fight: 1.25,            // scaled by lam below
    crowd: 0.9,
    radial: 0.95, radialLowBoost: 2.4,
    wall: 2.6,
    hunt: 1.35,
  };
  const ANTIC_STEPS = 7;    // how many steps of diffusion to anticipate

  // ---- helpers -------------------------------------------------------------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const kern = (r, l) => Math.exp(-(r * r) / (2 * l * l)); // 1 at r=0, →0 far
  let fx = 0, fy = 0;

  const myR = Math.hypot(me.x, me.y);
  // Outward radial unit vector (points from centre to me); random if at centre.
  let urx, ury;
  if (myR > 1e-6) { urx = me.x / myR; ury = me.y / myR; }
  else { const a = Math.random() * 2 * Math.PI; urx = Math.cos(a); ury = Math.sin(a); }

  // Diffusion-anticipation length scale (HJB blur). Uses σ and Δt.
  const diff = sigma * Math.sqrt(dt);
  const antic = diff * Math.sqrt(ANTIC_STEPS);
  const Ldanger = Math.sqrt(r_limit * r_limit + antic * antic);
  const Lint    = Math.sqrt(r_limit * r_limit + antic * antic);
  const Lcrowd  = 0.75 * r_limit;

  const aliveCount = others.length + 1;
  // Marginal value of HP: convex near death ⇒ fear damage more when weak.
  const vuln = 1 + W.kayaVuln * (1 - clamp(me.hp / 100, 0, 1));
  // Only hunt when I'm healthy enough to spend a little HP.
  const gHP = clamp((me.hp - 40) / 40, 0, 1);
  // Aggression grows as the field shrinks (finite-horizon correction). A small
  // baseline (~0.15) keeps me culling weak, isolated rivals throughout —
  // simulation shows persistent light predation beats pure pacifism, because
  // removing competitors shrinks the final pool faster than it costs me HP —
  // and it ramps to full as the field empties and closing becomes mandatory.
  const gEnd = clamp(1.15 - (aliveCount - 2) / Math.max(1, qty - 2), 0, 1);
  const fightScale = W.fight * (lam / 5); // λ makes duels more urgent

  // ---- 1. KAYA: repulsive Gaussian danger well ----------------------------
  const kaya = npcs.find((n) => n.type === "demon" || n.name === "Kaya");
  if (kaya) {
    const dx = me.x - kaya.x, dy = me.y - kaya.y;
    const r = Math.hypot(dx, dy) || 1e-6;
    const mag = W.kaya * KAYA_RATE * vuln * kern(r, Ldanger);
    fx += mag * (dx / r);
    fy += mag * (dy / r);
  }

  // ---- 4. BUTTER: conditional attractor (only while HP < 50) ---------------
  const butter = npcs.find((n) => n.type === "healer" || n.name === "Butter");
  if (butter && me.hp < HEAL_CAP) {
    const dx = butter.x - me.x, dy = butter.y - me.y;
    const r = Math.hypot(dx, dy) || 1e-6;
    const need = clamp((HEAL_CAP - me.hp) / HEAL_CAP, 0, 1);
    // Don't dive onto Butter if Kaya is sitting on top of Butter.
    let kayaGuard = 1;
    if (kaya) {
      const rk = Math.hypot(butter.x - kaya.x, butter.y - kaya.y);
      kayaGuard = clamp(rk / (1.5 * r_limit), 0.15, 1);
    }
    const mag = W.butter * BUTTER_RATE * need * kern(r, Lint) * kayaGuard;
    fx += mag * (dx / r);
    fy += mag * (dy / r);
  }

  // ---- 2+3. OPPONENTS: signed duel force + crowd repulsion -----------------
  for (const o of others) {
    const dx = me.x - o.x, dy = me.y - o.y;   // from opponent to me
    const r = Math.hypot(dx, dy);
    if (r < 1e-6) continue;
    const ux = dx / r, uy = dy / r;

    // Signed fight advantage from the exact win law.
    const s = (me.hp - o.hp) / (me.hp + o.hp + 1e-9);
    const kf = kern(r, Lint);

    if (s >= 0) {
      // Favourable: attract, but only if healthy, endgame-appropriate, and the
      // target is ISOLATED (few of its own neighbours ⇒ no swarm) and clear of
      // Kaya (don't chase a kill into the cat).
      let neigh = 0;
      for (const q of others) {
        if (q === o) continue;
        if (Math.hypot(q.x - o.x, q.y - o.y) < 1.5 * r_limit) neigh++;
      }
      const iso = 1 / (1 + neigh);
      let kayaClear = 1;
      if (kaya) kayaClear = clamp(Math.hypot(o.x - kaya.x, o.y - kaya.y) / (1.5 * r_limit), 0.1, 1);
      // As the field empties, HP-caution must yield to necessity: with few
      // rivals left there are no more "free" deaths to wait for, so I must
      // close and finish. endMix → 1 when ≤2 alive, lifting the gHP gate to 1.
      const endMix = clamp((5 - aliveCount) / 3, 0, 1);
      const gHPeff = gHP + (1 - gHP) * endMix;
      const gate = gHPeff * gEnd * iso * kayaClear;
      const mag = fightScale * s * kf * gate;
      fx -= mag * ux; fy -= mag * uy;       // toward the weaker opponent
    } else {
      // Unfavourable: flee the stronger. Never gated. Widen kernel a touch via
      // the anticipation scale so I peel away early.
      const mag = fightScale * (-s) * kern(r, Ldanger) * vuln;
      fx += mag * ux; fy += mag * uy;        // away
    }

    // Mean-field crowd repulsion (per-capita 1/N), independent of strength.
    const magC = (W.crowd / Math.max(2, qty)) * kern(r, Lcrowd);
    fx += magC * ux; fy += magC * uy;
  }

  // ---- 5. RADIAL CONTROL: home annulus / recovery-band commitment ----------
  // Healthy: camp just inside the rim (fewest neighbours). Low HP: push into
  // the recovery band (r ≥ 1 − r') to trigger border healing, strength ∝ β.
  const bandInner = 1 - r_prime;               // recovery starts here (~0.85)
  const rHome = clamp(bandInner - 0.02, 0.7, 0.9);   // healthy camp radius
  const rHeal = clamp(1 - 0.4 * r_prime, 0.85, 0.95); // sit inside the band
  const lowHP = clamp((RECOVER_HP + 8 - me.hp) / (RECOVER_HP + 8), 0, 1);
  const rTarget = rHome + (rHeal - rHome) * lowHP;
  const wRad = W.radial + W.radialLowBoost * lowHP * beta / 2; // β enters here
  const radialErr = rTarget - myR;             // >0 ⇒ move outward
  fx += wRad * radialErr * urx;
  fy += wRad * radialErr * ury;

  // ---- 6. WALL: soft inward push near r = 1 (avoid being clamped) ----------
  const rWall = 0.955;
  if (myR > rWall) {
    const t = (myR - rWall) / (1 - rWall);
    const mag = W.wall * t * t;
    fx -= mag * urx; fy -= mag * ury;
  }

  // ---- won already? drift gently to the safe camp -------------------------
  if (others.length === 0) {
    fx = (rHome - myR) * urx;
    fy = (rHome - myR) * ury;
  }

  // ---- project onto the speed cap (this IS the Π_{|v|≤maxSpeed}) -----------
  const m = Math.hypot(fx, fy);
  if (m > maxSpeed) { const k = maxSpeed / m; fx *= k; fy *= k; }

  // Optional debug — throttled by sim speed so logs don't flood. (uses speed)
  _tick++;
  if (typeof console !== "undefined" && _tick % Math.max(1, Math.round(40 / Math.max(0.25, speed))) === 0) {
    // console.log(`[${me.name}] hp=${me.hp.toFixed(0)} r=${myR.toFixed(2)} alive=${aliveCount} |v|=${Math.hypot(fx,fy).toFixed(2)}`);
  }

  return { dx: fx, dy: fy };
}
