// CourtRenderer.js
// -----------------------------------------------------------------------------
// PixiJS (WebGL) 2.5D renderer for the fight-sim court.
//
// This is a pure PRESENTATION layer. It knows nothing about the WASM engine or
// Vue — CourtCanvas.vue owns the sim loop, reads engine state, and calls
// `render(state)` once per frame with plain data. Swapping the old Canvas-2D
// `renderFrame()` for this class changes the *look*, never the simulation.
//
// The world is authored in the original 800x400 top-down coordinate space so the
// existing engine/fallback math is untouched. "2.5D" is sold through material
// shading, not geometry: a perspective-graded hardwood floor (far edge darker),
// glossy sheen, a vignette, standing "chip" tokens with ground shadows + rim
// light, and a glowing ball with a motion trail.
//
//   const r = new CourtRenderer(divEl, { width, height });
//   await r.ready;
//   r.render({ players, bots, ball, phase, coverage, shotClock });
//   r.destroy();
// -----------------------------------------------------------------------------

import { Application, Container, Graphics, Text, Sprite, Texture } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { FEEL, prefersReducedMotion, easeOutCubic, dribbleHeight, squashScale, ballShadow } from '../fx/feel.js';

const COURT_W = 800;
const COURT_H = 400;

const COLOR = {
  home: 0xd9534f,
  homeLight: 0xef8a86,
  away: 0x5bc0de,
  awayLight: 0x9ddcee,
  ball: 0xf4a300,
  carrier: 0xf4a300,
  line: 0xffffff,
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

// --- Baked hardwood floor texture -------------------------------------------
// Drawn once to an offscreen canvas: a warm vertical wood gradient that darkens
// toward the top (the "far" edge, faking depth), faint plank seams, and a broad
// soft highlight down the centre for a polished-floor sheen.
function makeFloorTexture(w, h) {
  const scale = 2; // supersample for crisp grain when the sprite is scaled up
  const cv = document.createElement('canvas');
  cv.width = w * scale;
  cv.height = h * scale;
  const c = cv.getContext('2d');
  c.scale(scale, scale);

  // Base wood gradient — darker at the top (far), warmer/brighter at the bottom.
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#6f4a25');
  g.addColorStop(0.5, '#9c7040');
  g.addColorStop(1, '#b78751');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);

  // Plank seams running the length of the court.
  c.strokeStyle = 'rgba(60, 38, 18, 0.28)';
  c.lineWidth = 1;
  const plankH = 26;
  for (let y = plankH; y < h; y += plankH) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }

  // Fine grain streaks for texture.
  c.strokeStyle = 'rgba(255, 226, 190, 0.05)';
  for (let i = 0; i < 240; i++) {
    const y = Math.random() * h;
    const x = Math.random() * w;
    const len = 12 + Math.random() * 40;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + len, y + (Math.random() - 0.5) * 2);
    c.stroke();
  }

  // Broad centre sheen — a soft radial highlight for the "waxed floor" look.
  const sheen = c.createRadialGradient(w / 2, h * 0.62, 40, w / 2, h * 0.62, w * 0.6);
  sheen.addColorStop(0, 'rgba(255, 240, 210, 0.16)');
  sheen.addColorStop(1, 'rgba(255, 240, 210, 0)');
  c.fillStyle = sheen;
  c.fillRect(0, 0, w, h);

  return Texture.from(cv);
}

// --- Baked vignette ----------------------------------------------------------
function makeVignetteTexture(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.42)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  return Texture.from(cv);
}

export class CourtRenderer {
  constructor(container, opts = {}) {
    this.container = container;
    this.width = opts.width || COURT_W;
    this.height = opts.height || COURT_H;
    this._resolution = opts.resolution || Math.min(2, window.devicePixelRatio || 1);

    this.app = new Application();
    this._destroyed = false;
    this._playerNodes = new Map(); // id -> node container
    this._rendered = new Map();    // id -> { x, y } smoothed screen pos
    this._ballTrail = [];          // recent ball positions for the trail

    this.ready = this._init();
  }

  async _init() {
    await this.app.init({
      width: this.width,
      height: this.height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: this._resolution,
      autoDensity: true,
    });
    if (this._destroyed) {
      this.app.destroy(true);
      return;
    }
    this.container.appendChild(this.app.canvas);
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.borderRadius = '6px';

    this.world = new Container();
    this.app.stage.addChild(this.world);

    this._buildCourt();

    this.coverageLayer = new Container();
    this.shadowLayer = new Container();
    this.playerLayer = new Container();
    this.fxLayer = new Container();
    this.world.addChild(this.coverageLayer, this.shadowLayer, this.playerLayer, this.fxLayer);

    // Ball + its glow live in the fx layer, above the players. Filters are
    // created once and reused (never per-frame) to avoid leaking GPU resources.
    this.ballTrailGfx = new Graphics();
    this.ballGfx = new Graphics();
    this.ballGfx.filters = [new GlowFilter({ distance: 12, outerStrength: 2.2, color: COLOR.ball, quality: 0.3 })];
    this.ringGfx = new Graphics();
    this._ringGlow = new GlowFilter({ distance: 8, outerStrength: 1.2, color: 0xffffff, quality: 0.2 });
    this.ringGfx.filters = [this._ringGlow];
    this.fxLayer.addChild(this.ballTrailGfx, this.ballGfx, this.ringGfx);

    this._ready = true;
  }

  _buildCourt() {
    // Floor
    const floor = new Sprite(makeFloorTexture(COURT_W, COURT_H));
    floor.width = COURT_W;
    floor.height = COURT_H;
    this.world.addChild(floor);

    // Court markings — crisp vector lines on top of the wood.
    const g = new Graphics();
    const cx = COURT_W / 2;
    const cy = COURT_H / 2;

    // Team-tinted paint fills (keys), softly glowing.
    g.rect(0, cy - 60, 120, 120).fill({ color: COLOR.away, alpha: 0.12 });
    g.rect(COURT_W - 120, cy - 60, 120, 120).fill({ color: COLOR.home, alpha: 0.12 });

    // Outer border
    g.rect(3, 3, COURT_W - 6, COURT_H - 6).stroke({ width: 4, color: 0x8b5a2b, alpha: 0.9 });

    // Half-court line + centre circle
    g.moveTo(cx, 6).lineTo(cx, COURT_H - 6).stroke({ width: 2, color: COLOR.line, alpha: 0.32 });
    g.circle(cx, cy, 40).stroke({ width: 2, color: COLOR.line, alpha: 0.32 });

    // Three-point arcs (left = away basket, right = home basket)
    g.arc(0, cy, 160, -Math.PI * 0.4, Math.PI * 0.4).stroke({ width: 2, color: COLOR.line, alpha: 0.3 });
    g.arc(COURT_W, cy, 160, Math.PI * 0.6, Math.PI * 1.4).stroke({ width: 2, color: COLOR.line, alpha: 0.3 });

    // Paint outlines
    g.rect(0, cy - 60, 120, 120).stroke({ width: 2, color: COLOR.line, alpha: 0.28 });
    g.rect(COURT_W - 120, cy - 60, 120, 120).stroke({ width: 2, color: COLOR.line, alpha: 0.28 });

    // Backboards
    g.moveTo(10, cy - 20).lineTo(10, cy + 20).stroke({ width: 3, color: COLOR.line, alpha: 0.5 });
    g.moveTo(COURT_W - 10, cy - 20).lineTo(COURT_W - 10, cy + 20).stroke({ width: 3, color: COLOR.line, alpha: 0.5 });

    // Rims
    g.circle(20, cy, 9).stroke({ width: 2, color: 0xff7a3c, alpha: 0.8 });
    g.circle(COURT_W - 20, cy, 9).stroke({ width: 2, color: 0xff7a3c, alpha: 0.8 });

    this.world.addChild(g);

    // Vignette on top of the floor (but under gameplay layers).
    const vign = new Sprite(makeVignetteTexture(COURT_W, COURT_H));
    vign.width = COURT_W;
    vign.height = COURT_H;
    this.world.addChild(vign);
  }

  // Build (once) a standing "chip" token for a player id.
  _makePlayerNode(team) {
    const node = new Container();
    const base = team === 'home' ? COLOR.home : COLOR.away;
    const light = team === 'home' ? COLOR.homeLight : COLOR.awayLight;

    // Ground shadow — a soft dark ellipse under the token, offset down.
    const shadow = new Graphics();
    shadow.ellipse(0, 15, 17, 7).fill({ color: 0x000000, alpha: 0.28 });
    shadow.ellipse(0, 15, 12, 5).fill({ color: 0x000000, alpha: 0.22 });

    // The chip body: a filled disc with a lighter top-lit cap for volume.
    const disc = new Graphics();
    disc.circle(0, 0, 15).fill({ color: base });
    disc.circle(0, 0, 15).stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
    disc.ellipse(0, -4, 10, 7).fill({ color: light, alpha: 0.55 }); // top rim-light

    const label = new Text({
      text: '',
      style: { fontFamily: 'Arial, sans-serif', fontSize: 9, fontWeight: '700', fill: 0xffffff, align: 'center' },
    });
    label.anchor.set(0.5);
    label.y = 0;

    node.addChild(shadow, disc, label);
    node._disc = disc;
    node._label = label;
    node._team = team;
    node._carrierGlow = new GlowFilter({ distance: 14, outerStrength: 2.6, color: COLOR.carrier, quality: 0.3 });
    return node;
  }

  _syncPlayers(list, team) {
    for (const p of list) {
      const cx = clamp(p.x + 15, 15, COURT_W - 15);
      const cy = clamp(p.y + 15, 15, COURT_H - 15);

      let node = this._playerNodes.get(p.id);
      if (!node) {
        node = this._makePlayerNode(team);
        this._playerNodes.set(p.id, node);
        this.playerLayer.addChild(node);
        this._rendered.set(p.id, { x: cx, y: cy });
      }

      // Positions arrive already interpolated between sim steps
      // (CourtCanvas syncLoop); draw them as-is.
      const r = this._rendered.get(p.id);
      r.x = cx;
      r.y = cy;
      node.x = r.x;
      node.y = r.y;

      const short = p.name ? p.name.split(' ').pop().slice(0, 3) : String(p.id);
      if (node._label.text !== short) node._label.text = short;
      node._seen = this._frame;
    }
  }

  render(state) {
    if (!this._ready || this._destroyed) return;
    this._frame = (this._frame || 0) + 1;

    const players = state.players || [];
    const bots = state.bots || [];
    const ball = state.ball || {};
    const possId = ball.possessorId;

    // --- Players (home + away) ---
    this._syncPlayers(bots, 'away');
    this._syncPlayers(players, 'home');

    // Prune nodes for players that vanished this frame.
    for (const [id, node] of this._playerNodes) {
      if (node._seen !== this._frame) {
        node.destroy({ children: true });
        this._playerNodes.delete(id);
        this._rendered.delete(id);
      }
    }

    // Carrier glow + record carrier screen pos for the shot-clock ring.
    let carrierPos = null;
    for (const [id, node] of this._playerNodes) {
      const isCarrier = id === possId;
      const wantGlow = isCarrier ? [node._carrierGlow] : null;
      if ((node._disc.filters && !isCarrier) || (isCarrier && !node._disc.filters)) {
        node._disc.filters = wantGlow;
      }
      if (isCarrier) carrierPos = { x: node.x, y: node.y };
    }

    // --- Coverage preview (prefight only) ---
    this._drawCoverage(state.coverage);

    // --- Ball + trail ---
    this._drawBall(ball);

    // --- Shot-clock ring around the carrier (live only) ---
    this._drawRing(state.shotClock, carrierPos);
  }

  _drawCoverage(coverage) {
    const layer = this.coverageLayer;
    layer.removeChildren().forEach((ch) => ch.destroy({ children: true }));
    if (!coverage || !coverage.length) return;

    for (const z of coverage) {
      const g = new Graphics();
      const a = z.alpha ?? 1;
      if (z.warm) {
        // Brighter fill + hot rim reads as "funnel them here" without a
        // per-frame glow filter (which would leak GPU resources on rAF).
        g.ellipse(z.cx, z.cy, z.rx, z.ry).fill({ color: 0xff7a28, alpha: (0.16 + 0.55 * z.mag) * a });
        g.ellipse(z.cx, z.cy, z.rx, z.ry).stroke({ width: 2, color: 0xffbe82, alpha: 0.8 * a });
      } else {
        g.ellipse(z.cx, z.cy, z.rx, z.ry).fill({ color: 0x1c3a82, alpha: (0.15 + 0.5 * z.mag) * a });
        g.ellipse(z.cx, z.cy, z.rx, z.ry).stroke({ width: 1.5, color: 0x5f8cdc, alpha: 0.5 * a });
      }
      layer.addChild(g);

      const t = new Text({
        text: `${z.label} ${z.warm ? '▲' : '▼'}`,
        style: {
          fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: '700',
          fill: z.warm ? 0xffd2aa : 0xa0bee6,
        },
      });
      t.anchor.set(0.5);
      t.x = z.cx;
      t.y = z.cy;
      t.alpha = a;
      layer.addChild(t);
    }
  }

  // The ball has three looks: held (glued to the carrier's token, dribbling),
  // airborne (engine position lifted by z, shadow on the floor, ember trail)
  // and loose on the floor (no trail). Holder changes — a pass, a steal, a
  // release — ease from the last drawn spot instead of snapping or streaking.
  _drawBall(ball) {
    const trail = this.ballTrailGfx;
    const g = this.ballGfx;
    trail.clear();
    g.clear();
    if (ball.x == null) return;

    const cfg = FEEL.ball;
    const now = performance.now();
    const still = prefersReducedMotion();
    const z = Math.max(0, ball.z || 0);
    const holder = this._playerNodes.get(ball.possessorId);
    const holderKey = holder ? ball.possessorId : 'air';

    let bx, by, gx, gy, h; // ball centre, ground point, height above it (px)
    let radius = 6;
    if (holder) {
      const side = this._ballFacingSide(holder);
      gx = holder.x + side * cfg.handOffsetX;
      gy = holder.y + cfg.handOffsetY;
      h = still ? cfg.dribbleAmp : dribbleHeight(now, cfg);
      this._ballTrail.length = 0; // never streak from the last shot to the hands
    } else {
      gx = ball.x + 6;
      gy = ball.y + 6;
      h = z * cfg.liftPerZ;
      radius = 6 * (1 + z * 0.04);
      this._ballFacing = null;
    }

    // Floor hit: falling through landZ while loose starts a squash.
    const prevZ = this._ballPrevZ ?? 0;
    if (!holder && !still && prevZ > cfg.landZ && z <= cfg.landZ) this._ballSquashAt = now;
    this._ballPrevZ = holder ? 0 : z;

    bx = clamp(gx, 6, COURT_W - 6);
    by = clamp(gy - h, 6, COURT_H - 6);
    ({ x: bx, y: by } = this._ballHandoff(holderKey, bx, by, now, still));

    // Floor shadow at the ground point; a held ball's shadow pulses with the
    // bounce, an airborne one shrinks and fades with height.
    let sh = ballShadow(z, cfg);
    if (holder) {
      const up = h / cfg.dribbleAmp; // 0 at floor contact, 1 in the hand
      sh = { scale: 1 - 0.5 * cfg.dribbleShadowPulse * up, alpha: cfg.shadowMaxAlpha * (1 - cfg.dribbleShadowPulse * up) };
    }
    trail.ellipse(clamp(gx, 6, COURT_W - 6), clamp(gy + 4, 6, COURT_H - 6), 7 * sh.scale, 3 * sh.scale)
      .fill({ color: 0x000000, alpha: sh.alpha });

    this._drawBallTrail(trail, holder ? null : { x: bx, y: by }, z);

    // Squash-and-stretch on contact, eased back to round.
    let sx = 1;
    let sy = 1;
    if (this._ballSquashAt != null) {
      const age = now - this._ballSquashAt;
      if (age >= cfg.squashMs) this._ballSquashAt = null;
      else ({ sx, sy } = squashScale(age, cfg));
    }
    // Squash about the contact point so the ball stays on the floor.
    const cy = by + radius * (1 - sy);
    const rx = radius * sx;
    const ry = radius * sy;
    g.ellipse(bx, cy, rx, ry).fill({ color: COLOR.ball });
    g.ellipse(bx, cy, rx, ry).stroke({ width: 1.5, color: 0xffffff, alpha: 0.9 });
    // Seam line for a touch of detail.
    g.moveTo(bx - rx, cy).lineTo(bx + rx, cy).stroke({ width: 1, color: 0x7a4a00, alpha: 0.6 });

    this._ballDrawn = { x: bx, y: by, holderKey };
  }

  // Which side of the token the carrier holds the ball on: the way they're
  // moving horizontally, held through pauses (+1 right, -1 left).
  _ballFacingSide(node) {
    const f = this._ballFacing;
    if (!f || f.node !== node) {
      this._ballFacing = { node, lastX: node.x, side: f?.side ?? 1 };
      return this._ballFacing.side;
    }
    const dx = node.x - f.lastX;
    if (Math.abs(dx) > FEEL.ball.facingDeadzone) f.side = Math.sign(dx);
    f.lastX = node.x;
    return f.side;
  }

  // When the holder changes, blend from the last drawn spot to the new
  // target over handoffMs (a snap under reduced motion).
  _ballHandoff(holderKey, x, y, now, still) {
    const last = this._ballDrawn;
    if (last && last.holderKey !== holderKey && !still) {
      this._ballBlend = { from: { x: last.x, y: last.y }, at: now };
    }
    const b = this._ballBlend;
    if (!b) return { x, y };
    const t = (now - b.at) / FEEL.ball.handoffMs;
    if (t >= 1) {
      this._ballBlend = null;
      return { x, y };
    }
    const k = easeOutCubic(t);
    return { x: lerp(b.from.x, x, k), y: lerp(b.from.y, y, k) };
  }

  // Ember trail, only while the ball is meaningfully airborne. On the floor
  // the history drains a sample a frame so the tail fades instead of popping.
  _drawBallTrail(trail, pos, z) {
    const cfg = FEEL.ball;
    const hist = this._ballTrail;
    if (pos && z > cfg.trailMinZ) {
      const lastP = hist[hist.length - 1];
      if (lastP && Math.hypot(pos.x - lastP.x, pos.y - lastP.y) > cfg.trailJumpPx) hist.length = 0;
      hist.push(pos);
      if (hist.length > cfg.trailLength) hist.shift();
    } else if (hist.length) {
      hist.shift();
    }
    if (hist.length < 2) return;

    const [r, gg, b] = cfg.trailColor;
    const color = (r << 16) | (gg << 8) | b;
    for (let i = 1; i < hist.length; i++) {
      const f = i / (hist.length - 1); // 0 = oldest, 1 = newest
      trail.moveTo(hist[i - 1].x, hist[i - 1].y).lineTo(hist[i].x, hist[i].y)
        .stroke({ width: Math.max(1, cfg.trailWidth * f), color, alpha: 0.08 + 0.4 * f, cap: 'round' });
    }
  }

  _drawRing(shotClock, carrierPos) {
    const g = this.ringGfx;
    g.clear();
    if (!shotClock || !carrierPos) return;

    const f = clamp(shotClock.frac, 0, 1); // remaining fraction
    const t = 1 - f;                        // urgency
    // Heat ramp: cool blue (fresh) -> hot red (urgent).
    const r = t < 0.5 ? Math.round(lerp(56, 255, t / 0.5)) : 255;
    const gg = t < 0.5 ? Math.round(lerp(132, 180, t / 0.5)) : Math.round(lerp(180, 55, (t - 0.5) / 0.5));
    const b = t < 0.5 ? Math.round(lerp(255, 40, t / 0.5)) : Math.round(lerp(40, 30, (t - 0.5) / 0.5));
    const color = (r << 16) | (gg << 8) | b;
    const outerR = 24 - 6 * t;

    // Background track
    g.circle(carrierPos.x, carrierPos.y, outerR).stroke({ width: 3, color: 0xffffff, alpha: 0.12 });

    // Remaining-time arc. moveTo the arc's start point first — otherwise the
    // path connects (0,0) to the start with a stray line across the court.
    const startAng = -Math.PI / 2;
    const endAng = startAng + f * Math.PI * 2;
    const sx = carrierPos.x + Math.cos(startAng) * outerR;
    const sy = carrierPos.y + Math.sin(startAng) * outerR;
    const pulse = t > 0.66 ? 1.4 * (0.5 + 0.5 * Math.sin(performance.now() * 0.018)) : 0;
    g.moveTo(sx, sy);
    g.arc(carrierPos.x, carrierPos.y, outerR, startAng, endAng)
      .stroke({ width: 3.5 + pulse, color, alpha: 0.95, cap: 'round' });

    // Reuse the shared glow filter; just retint / restrengthen it each frame.
    this._ringGlow.color = color;
    this._ringGlow.outerStrength = 0.6 + 1.4 * t;
  }

  destroy() {
    this._destroyed = true;
    this._ready = false;
    if (this.app && this.app.renderer) {
      try {
        const canvas = this.app.canvas;
        this.app.destroy(true, { children: true, texture: true });
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      } catch (e) { /* already torn down */ }
    }
  }
}

export default CourtRenderer;
