// feel.js — one place to tune ALL game-feel in Hardwood Autochess.
// Pure JS, zero deps. Springs, particles, screen shake, easing.
// Every magic number lives in FEEL below; the components read from it.

export const FEEL = {
  // ── Ball & shot feel (CourtCanvas) ─────────────────────────────
  ball: {
    trailLength: 14,          // samples kept in the motion-trail ring buffer
    trailMinZ: 0.4,           // trail only shows once ball is meaningfully airborne
    trailWidth: 5,            // px width of the widest (newest) trail segment
    trailColor: [255, 176, 64],  // warm ember RGB for the trail glow
    shadowMaxAlpha: 0.35,     // floor-shadow opacity when ball is on the deck
    shadowShrink: 0.028,      // how much the shadow tightens per unit of z
    liftPerZ: 3,              // px of visual lift per unit of ball z (matches sim)
  },

  // ── Rim / net / backboard moments (CourtCanvas) ────────────────
  rim: {
    rippleRings: 3,           // concentric rings per make
    rippleDuration: 0.65,     // s for a ring to fully expand + fade
    rippleMaxRadius: 46,      // px final radius of the outermost ring
    rippleColor: [255, 214, 90],
    netFlickDuration: 0.5,    // s of net-strand swing after a make
    netFlickAmp: 6,           // px of strand deflection at t=0
    boardShudderDuration: 0.45, // s of backboard oscillation on a miss
    boardShudderAmp: 4,       // px initial backboard deflection
    boardShudderFreq: 22,     // rad/s oscillation speed
  },

  // ── Screen shake (CourtCanvas) ─────────────────────────────────
  shake: {
    weights: { score: 1.0, steal: 0.6, pass: 0.22, miss: 0.45 },
    maxOffset: 7,             // px at weight 1.0
    decay: 6.5,               // 1/s exponential decay of trauma
    freq: 31,                 // rad/s noise frequency
  },

  // ── Acting-unit highlight pulse (CourtCanvas) ──────────────────
  pulse: {
    duration: 0.6,            // s
    maxRadius: 30,            // px ring radius at end of pulse
    color: [255, 214, 90],
  },

  // ── Floating stat numbers (CourtCanvas) ────────────────────────
  floaters: {
    launchVy: -95,            // px/s initial upward velocity
    gravity: 150,             // px/s^2 pulling numbers back down
    life: 1.15,               // s to full fade
    popScale: 1.45,           // overshoot scale at birth (eases to 1)
    fontPx: 20,               // base font size
    maxActive: 12,            // hard cap
  },

  // ── Particles (both components) ────────────────────────────────
  particles: {
    maxActive: 140,           // global hard cap per canvas
    dustCount: 10,            // puff size on a unit landing
    dustSpeed: 70,            // px/s initial burst velocity
    dustLife: 0.55,           // s
    dustColor: [214, 180, 130],  // hardwood dust
    crowdCount: 26,           // ambient shimmer particles along court edges
    crowdDriftSpeed: 9,       // px/s lateral drift
    crowdTwinkleHz: 1.6,      // brightness oscillation
    crowdColor: [255, 200, 120],
  },

  // ── Planning-phase drag & drop (PlanningPhase) ─────────────────
  drag: {
    followStiffness: 190,     // spring k for the avatar chasing the pointer
    followDamping: 16,        // spring c — under-damped so it lags + overshoots
    returnStiffness: 130,     // rubber-band back to origin on invalid drop
    returnDamping: 12,
    slopPx: 7,                // movement below this is a tap, not a drag
    liftScale: 1.12,          // avatar grows slightly while held
    settleEps: 1.5,           // px/vel threshold to consider a spring settled
  },

  // ── Squash & stretch landing (PlanningPhase) ───────────────────
  land: {
    duration: 0.4,            // s of the squash-stretch keyframe
    squashX: 1.28,
    squashY: 0.72,
  },

  // ── Ambient idle breathing (PlanningPhase) ─────────────────────
  breathe: {
    period: 2.8,              // s per breath cycle
    scaleAmp: 0.03,           // ±3% scale
  },

  // ── Spring HP bar (SpringBar.vue) ──────────────────────────────
  hpBar: {
    stiffness: 60,
    damping: 10,
  },
};

// ── Reduced motion ────────────────────────────────────────────────
let _prm = null;
export function prefersReducedMotion() {
  if (_prm === null) {
    _prm = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false };
  }
  return _prm.matches;
}

// ── Easing ────────────────────────────────────────────────────────
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t, s = 1.70158) => {
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};

// ── 1D damped spring ──────────────────────────────────────────────
// Semi-implicit Euler; stable for the stiffness range used here at 60fps.
export class Spring {
  constructor(value = 0, stiffness = 170, damping = 14) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }
  update(dt) {
    // clamp dt so a background-tab resume can't explode the integrator
    const h = Math.min(dt, 1 / 30);
    const accel = (this.target - this.value) * this.stiffness - this.velocity * this.damping;
    this.velocity += accel * h;
    this.value += this.velocity * h;
    return this.value;
  }
  settled(eps = 0.5) {
    return Math.abs(this.target - this.value) < eps && Math.abs(this.velocity) < eps * 10;
  }
  snap(v) {
    this.value = v;
    this.target = v;
    this.velocity = 0;
  }
}

// ── Screen shake (trauma model: intensity decays, offset is noise) ─
export class Shake {
  constructor(cfg = FEEL.shake) {
    this.cfg = cfg;
    this.trauma = 0;
    this.t = 0;
  }
  add(weight) {
    if (prefersReducedMotion()) return;
    this.trauma = Math.min(1, this.trauma + weight);
  }
  update(dt) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - this.cfg.decay * this.trauma * dt);
  }
  // squared trauma feels better: small hits barely register, big hits slam
  get offsetX() {
    const s = this.trauma * this.trauma * this.cfg.maxOffset;
    return Math.sin(this.t * this.cfg.freq) * s;
  }
  get offsetY() {
    const s = this.trauma * this.trauma * this.cfg.maxOffset;
    return Math.cos(this.t * this.cfg.freq * 1.31) * s;
  }
}

// ── Tiny particle pool (fixed cap, recycles oldest when full) ─────
export class ParticlePool {
  constructor(max = FEEL.particles.maxActive) {
    this.max = max;
    this.items = [];
  }
  spawn(props) {
    if (prefersReducedMotion()) return;
    if (this.items.length >= this.max) this.items.shift(); // recycle oldest
    this.items.push({ age: 0, ...props });
  }
  update(dt) {
    const alive = [];
    for (const p of this.items) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vx = (p.vx || 0) * (1 - (p.drag || 0) * dt);
      p.vy = (p.vy || 0) + (p.gravity || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      alive.push(p);
    }
    this.items = alive;
  }
  get length() { return this.items.length; }
}

// Spawn a hardwood dust puff into a pool at (x, y).
export function spawnDust(pool, x, y, cfg = FEEL.particles) {
  for (let i = 0; i < cfg.dustCount; i++) {
    const ang = Math.PI + (Math.random() - 0.5) * Math.PI * 1.4; // mostly outward+up
    const speed = cfg.dustSpeed * (0.4 + Math.random() * 0.6);
    pool.spawn({
      x, y,
      vx: Math.cos(ang) * speed * (Math.random() < 0.5 ? 1 : -1),
      vy: Math.sin(ang) * speed * 0.5 - 20,
      gravity: 90,
      drag: 2.5,
      life: cfg.dustLife * (0.6 + Math.random() * 0.4),
      size: 1.5 + Math.random() * 2.5,
      color: cfg.dustColor,
    });
  }
}

// Draw every particle in a pool as soft fading dots.
export function drawParticles(ctx, pool) {
  for (const p of pool.items) {
    const t = p.age / p.life;
    const alpha = (1 - t) * (p.alpha ?? 0.8);
    const [r, g, b] = p.color;
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
}
