// CourtGuides.js
// -----------------------------------------------------------------------------
// The legibility layer and ability effects for CourtRenderer, drawn in Pixi so
// they share the camera and the screen shake with everything else.
//
// Two Graphics, redrawn each frame while anything is live:
//   floor  under the players: your ring, the move marker, the line to your man,
//          lock rings, The Wall's zone, the aim line, speed streaks, step-back
//          afterimages, the closeout trail, the Limitless aura
//   over   above the players: your arrow, lock flashes, aura sparkles
//
// Inputs come from the frame: `state.overlay` (Full Court only) and each
// player's `anim` (see client/moba/anim.js). Hardwood sends neither, so for it
// this draws nothing.
// -----------------------------------------------------------------------------

import { Graphics, Text } from 'pixi.js';
import { easeOutCubic } from '../fx/feel.js';

const GOLD = 0xf2b45f;
const GOLD_HOT = 0xffd27a;
const LOCK = 0xff5a3c;
const MARK = 0x8ce6a0;
const TEAM = { home: 0xef8a86, away: 0x9ddcee };
const TEAM_DEEP = { home: 0xd9534f, away: 0x3fa7cc };

const AFTERIMAGE_LIFE = 0.45;   // s a step-back ghost lingers
const AFTERIMAGE_EVERY = 0.03;  // s between ghosts while dashing
const TRAIL_LIFE = 0.4;         // s the closeout trail lingers
const FLASH_LIFE = 0.55;        // s of a lock flash
const MARKER_SETTLE = 0.35;     // s for a new move marker to land

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Dashed line from a to b; `offset` (px) slides the dashes along. */
function dashed(g, a, b, dash, gap, offset, style) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  const period = dash + gap;
  let s = -((offset % period) + period) % period;
  for (; s < len; s += period) {
    const s0 = Math.max(0, s);
    const s1 = Math.min(len, s + dash);
    if (s1 <= s0) continue;
    g.moveTo(a.x + ux * s0, a.y + uy * s0).lineTo(a.x + ux * s1, a.y + uy * s1);
  }
  g.stroke(style);
}

/** Dashed circle; `phase` (radians) turns it. */
function dashedCircle(g, x, y, r, segments, fill, phase, style) {
  const step = (Math.PI * 2) / segments;
  for (let i = 0; i < segments; i++) {
    const a0 = phase + i * step;
    const a1 = a0 + step * fill;
    g.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
    g.arc(x, y, r, a0, a1);
  }
  g.stroke(style);
}

/** A top-down silhouette (shoulders + head) for afterimages. */
function silhouette(g, x, y, facing, color, alpha, scale = 1) {
  const c = Math.cos(facing) * scale;
  const s = Math.sin(facing) * scale;
  g.setTransform(c, s, -s, c, x, y);
  g.roundRect(-6, -12.5, 12, 25, 6).fill({ color, alpha });
  g.circle(0.6, 0, 5.2).fill({ color, alpha: alpha * 1.2 });
  g.resetTransform();
}

export class CourtGuides {
  constructor(floorLayer, overLayer) {
    this.floor = new Graphics();
    this.over = new Graphics();
    floorLayer.addChild(this.floor);
    overLayer.addChild(this.over);

    this.flashText = new Text({
      text: 'LOCKED',
      style: {
        fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: '900', fill: 0xffffff,
        stroke: { color: 0x5a0f00, width: 3 }, letterSpacing: 1,
      },
    });
    this.flashText.anchor.set(0.5);
    this.flashText.visible = false;
    overLayer.addChild(this.flashText);

    this.time = 0;
    this.ghosts = [];       // { x, y, facing, color, age }
    this.trails = new Map(); // id -> { pts: [{x,y,age}], color }
    this.flashes = [];      // { x, y, age, id }
    this.sc = 1;
    this._lastGhostAt = new Map();
    this._wasLocked = new Map();
    this._marker = null;    // { x, y, age }
    this._drawn = false;
  }

  /**
   * @param {number} dt seconds
   * @param {object} f
   *   overlay  Full Court overlay ({ human, marker, man, zones, locks }) or null
   *   cursor   court-space aim point or null
   *   actors   [{ id, x, y, team, anim, facing, human, carrier }]
   *   still    prefers-reduced-motion
   */
  update(dt, { overlay, cursor, actors, still, scale = 1 }) {
    this.sc = scale; // figures grow on a phone; rings around them follow
    this.time += dt;
    const g = this.floor;
    const o = this.over;
    g.clear();
    o.clear();
    this._age(dt);

    const anyAnim = actors.some((a) => a.anim || a.carrier);
    if (!overlay && !anyAnim && !this.ghosts.length && !this.flashes.length) {
      this.flashText.visible = false;
      return;
    }

    if (overlay) this._drawZones(g, overlay.zones || [], still);
    for (const a of actors) {
      if (a.carrier) this._drawCarrier(g, a, still);
      this._actorFx(g, o, a, dt, still);
    }
    this._drawGhosts(g);
    this._drawTrails(g);
    if (overlay) this._drawGuides(g, o, overlay, cursor, actors, still);
    this._drawFlashes(o, still);
  }

  _age(dt) {
    for (const gh of this.ghosts) gh.age += dt;
    this.ghosts = this.ghosts.filter((gh) => gh.age < AFTERIMAGE_LIFE);
    for (const [id, tr] of this.trails) {
      for (const p of tr.pts) p.age += dt;
      tr.pts = tr.pts.filter((p) => p.age < TRAIL_LIFE);
      if (!tr.pts.length) this.trails.delete(id);
    }
    for (const f of this.flashes) f.age += dt;
    this.flashes = this.flashes.filter((f) => f.age < FLASH_LIFE);
    if (this._marker) this._marker.age += dt;
  }

  // Per-player ability looks, keyed off the frame's anim.
  _actorFx(g, o, a, dt, still) {
    const an = a.anim;
    if (!an) return;
    const b = an.buffs || {};
    const speed = Math.hypot(an.vx || 0, an.vy || 0);

    // Limitless Range: a gold aura with turning rays on the floor, sparkles
    // circling above, so "threes from anywhere" is on for all to see.
    if (b.limitless > 0) {
      const fade = clamp(b.limitless / 0.5, 0, 1);
      const pulse = still ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * 6);
      for (let i = 3; i >= 1; i--) {
        g.circle(a.x, a.y, 22 + i * 5 + pulse * 2).fill({ color: GOLD_HOT, alpha: 0.06 * fade });
      }
      const rays = 12;
      const spin = still ? 0 : this.time * 1.2;
      for (let i = 0; i < rays; i++) {
        const ang = spin + (i * Math.PI * 2) / rays;
        const r0 = 27;
        const r1 = 33 + (i % 2 ? 2 : 5) + pulse * 2;
        g.moveTo(a.x + Math.cos(ang) * r0, a.y + Math.sin(ang) * r0).lineTo(a.x + Math.cos(ang) * r1, a.y + Math.sin(ang) * r1);
      }
      g.stroke({ width: 2.2, color: GOLD_HOT, alpha: 0.85 * fade, cap: 'round' });
      g.circle(a.x, a.y, 27).stroke({ width: 1.2, color: 0xfff1c4, alpha: 0.6 * fade });
      const n = 4;
      for (let i = 0; i < n; i++) {
        const ang = (still ? 0 : this.time * 3.2) + (i * Math.PI * 2) / n;
        o.circle(a.x + Math.cos(ang) * 24, a.y + Math.sin(ang) * 24 * 0.8 - 4, 2.2).fill({ color: 0xfff1c4, alpha: 0.95 * fade });
      }
    }

    // Burst and Fast Break: speed streaks behind the runner.
    const boosted = b.burst > 0 || b.fastbreak > 0;
    if (boosted && speed > 30) {
      const ux = -(an.vx / speed);
      const uy = -(an.vy / speed);
      const px = -uy;
      const py = ux;
      const strong = b.burst > 0;
      const lines = strong ? 4 : 2;
      const color = strong ? 0xe8fbff : TEAM[a.team] || 0xffffff;
      for (let i = 0; i < lines; i++) {
        const off = (i - (lines - 1) / 2) * 6;
        const flick = still ? 0.7 : 0.55 + 0.45 * Math.abs(Math.sin(this.time * 17 + i * 1.9));
        const len = (strong ? 26 : 16) * flick * clamp(speed / 160, 0.6, 1.6);
        const sx = a.x + ux * 12 + px * off;
        const sy = a.y + uy * 12 + py * off;
        g.moveTo(sx, sy).lineTo(sx + ux * len, sy + uy * len)
          .stroke({ width: strong ? 2 : 1.5, color, alpha: strong ? 0.7 : 0.45, cap: 'round' });
      }
    }

    // Step-back: afterimages left along the dash.
    if (an.action === 'dash' && an.kind === 'stepback') {
      const last = this._lastGhostAt.get(a.id) ?? -1;
      if (this.time - last >= AFTERIMAGE_EVERY) {
        this._lastGhostAt.set(a.id, this.time);
        this.ghosts.push({ x: a.x, y: a.y, facing: a.facing, color: 0xdff6ff, age: 0 });
        if (this.ghosts.length > 24) this.ghosts.shift();
      }
    }

    // Closeout: a tapered lunge trail.
    if (an.action === 'dash' && an.kind === 'closeout') {
      let tr = this.trails.get(a.id);
      if (!tr) { tr = { pts: [], color: TEAM[a.team] || 0xffffff }; this.trails.set(a.id, tr); }
      tr.pts.push({ x: a.x, y: a.y, age: 0 });
      if (tr.pts.length > 30) tr.pts.shift();
    }

    // A lock starting: flash on the locked player.
    const was = this._wasLocked.get(a.id) || false;
    if (an.locked && !was) this.flashes.push({ id: a.id, x: a.x, y: a.y, age: 0 });
    this._wasLocked.set(a.id, !!an.locked);
    for (const f of this.flashes) if (f.id === a.id) { f.x = a.x; f.y = a.y; }
  }

  // The ball carrier stands in a warm pool of light, so the ball's owner
  // reads at a glance even when the ball is small on a phone.
  _drawCarrier(g, a, still) {
    const pulse = still ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * 5);
    g.circle(a.x, a.y + 2, 19 * this.sc).fill({ color: 0xffb340, alpha: 0.2 + 0.06 * pulse });
    g.circle(a.x, a.y + 2, 19 * this.sc).stroke({ width: 1.5, color: 0xffc766, alpha: 0.55 });
  }

  _drawGhosts(g) {
    for (const gh of this.ghosts) {
      const k = 1 - gh.age / AFTERIMAGE_LIFE;
      silhouette(g, gh.x, gh.y, gh.facing, gh.color, 0.4 * k * k, 1 + 0.1 * (1 - k));
    }
  }

  _drawTrails(g) {
    for (const tr of this.trails.values()) {
      const pts = tr.pts;
      for (let i = 1; i < pts.length; i++) {
        const k = 1 - pts[i].age / TRAIL_LIFE;
        const along = i / (pts.length - 1);
        g.moveTo(pts[i - 1].x, pts[i - 1].y).lineTo(pts[i].x, pts[i].y)
          .stroke({ width: 3 + 13 * along * k, color: tr.color, alpha: 0.4 * k, cap: 'round' });
      }
    }
  }

  // The Wall: a shimmering floor zone around its owner.
  _drawZones(g, zones, still) {
    for (const z of zones) {
      const col = TEAM[z.team] || 0xffffff;
      const deep = TEAM_DEEP[z.team] || 0xffffff;
      g.circle(z.x, z.y, z.r).fill({ color: deep, alpha: 0.13 });
      g.circle(z.x, z.y, z.r * 0.66).fill({ color: deep, alpha: 0.07 });
      // Rings drifting outward from the owner: the shimmer.
      if (!still) {
        for (let i = 0; i < 3; i++) {
          const k = ((this.time * 0.6 + i / 3) % 1);
          g.circle(z.x, z.y, z.r * (0.25 + 0.75 * k)).stroke({ width: 1.5, color: col, alpha: 0.35 * (1 - k) });
        }
      }
      // Hex-ish floor tiles: short arcs that twinkle.
      const tiles = 10;
      for (let i = 0; i < tiles; i++) {
        const ang = (i / tiles) * Math.PI * 2 + (still ? 0 : this.time * 0.25);
        const tw = still ? 0.4 : 0.25 + 0.35 * Math.abs(Math.sin(this.time * 3 + i * 1.7));
        g.moveTo(z.x + Math.cos(ang) * z.r * 0.82, z.y + Math.sin(ang) * z.r * 0.82)
          .arc(z.x, z.y, z.r * 0.82, ang, ang + 0.28)
          .stroke({ width: 3, color: 0xffffff, alpha: tw * 0.5 });
      }
      dashedCircle(g, z.x, z.y, z.r, 18, 0.6, still ? 0 : -this.time * 0.8, { width: 2.5, color: col, alpha: 0.9 });
    }
  }

  _drawGuides(g, o, ov, cursor, actors, still) {
    const me = actors.find((a) => a.human);
    const human = me || (ov.human ? { x: ov.human.x, y: ov.human.y, facing: 0 } : null);
    if (!human) return;
    const t = this.time;

    // Aim: dotted line to the cursor, with a small crosshair.
    if (cursor) {
      dashed(g, human, cursor, 2, 6, 0, { width: 1.2, color: 0xf3eee2, alpha: 0.32 });
      g.circle(cursor.x, cursor.y, 5).stroke({ width: 1.2, color: 0xf3eee2, alpha: 0.45 });
    }

    // Your man: a moving dashed line and corner brackets around him.
    if (ov.man) {
      dashed(g, human, ov.man, 5, 6, still ? 0 : -t * 30, { width: 2, color: GOLD, alpha: 0.85 });
      const r = 18 * this.sc;
      const L = 7 * this.sc;
      const m = ov.man;
      g.moveTo(m.x - r, m.y - r + L).lineTo(m.x - r, m.y - r).lineTo(m.x - r + L, m.y - r)
        .moveTo(m.x + r - L, m.y - r).lineTo(m.x + r, m.y - r).lineTo(m.x + r, m.y - r + L)
        .moveTo(m.x + r, m.y + r - L).lineTo(m.x + r, m.y + r).lineTo(m.x + r - L, m.y + r)
        .moveTo(m.x - r + L, m.y + r).lineTo(m.x - r, m.y + r).lineTo(m.x - r, m.y + r - L)
        .stroke({ width: 2.2, color: GOLD, alpha: 0.95 });
    }

    // Your passing lanes while you hold the ball: green when the teammate is
    // open and the lane is clear, red where a defender sits in it.
    for (const l of ov.passLanes || []) {
      const good = l.open && l.laneClear;
      if (good) {
        g.moveTo(human.x, human.y).lineTo(l.x, l.y).stroke({ width: 2, color: MARK, alpha: 0.7 });
        g.circle(l.x, l.y, 19 * this.sc).stroke({ width: 2, color: MARK, alpha: 0.85 });
      } else {
        dashed(g, human, l, 3, 5, 0, l.laneClear
          ? { width: 1.25, color: 0xf3eee2, alpha: 0.18 }
          : { width: 1.25, color: LOCK, alpha: 0.45 });
      }
    }

    // Denied men: a turning dashed gold ring, nobody passes to them for a beat.
    for (const d of ov.denies || []) {
      dashedCircle(g, d.x, d.y, 22 * this.sc, 10, 0.55, still ? 0 : t * 0.8, { width: 2, color: GOLD_HOT, alpha: 0.95 });
    }

    // Stumbling defenders, beaten by a step-back: three dots circling the head.
    for (const st of ov.stumbles || []) {
      for (let i = 0; i < 3; i++) {
        const a = (still ? 0 : t * 6) + (i * Math.PI * 2) / 3;
        g.circle(st.x + Math.cos(a) * 12 * this.sc, st.y - 20 * this.sc + Math.sin(a) * 4, 2).fill({ color: 0xf3eee2, alpha: 0.9 });
      }
    }

    // Locked carriers: a red crosshair ring.
    for (const l of ov.locks || []) {
      const spin = still ? 0 : t * 1.5;
      const sc = this.sc;
      g.circle(l.x, l.y, 21 * sc).stroke({ width: 2.5, color: LOCK, alpha: 0.9 });
      for (let i = 0; i < 4; i++) {
        const a = spin + (i * Math.PI) / 2;
        g.moveTo(l.x + Math.cos(a) * 17 * sc, l.y + Math.sin(a) * 17 * sc).lineTo(l.x + Math.cos(a) * 26 * sc, l.y + Math.sin(a) * 26 * sc);
      }
      g.stroke({ width: 2.5, color: LOCK, alpha: 0.9 });
    }

    // Move marker: lands with a shrinking ring, then holds as an X.
    const mk = ov.marker;
    if (mk) {
      if (!this._marker || Math.hypot(this._marker.x - mk.x, this._marker.y - mk.y) > 6) this._marker = { x: mk.x, y: mk.y, age: 0 };
      else { this._marker.x = mk.x; this._marker.y = mk.y; }
      const k = still ? 1 : clamp(this._marker.age / MARKER_SETTLE, 0, 1);
      const e = easeOutCubic(k);
      if (k < 1) g.circle(mk.x, mk.y, 16 - 10 * e).stroke({ width: 2, color: MARK, alpha: 0.9 * (1 - k) + 0.2 });
      const s = 5;
      g.moveTo(mk.x - s, mk.y - s).lineTo(mk.x + s, mk.y + s).moveTo(mk.x + s, mk.y - s).lineTo(mk.x - s, mk.y + s)
        .stroke({ width: 2.2, color: MARK, alpha: 0.95 });
      g.ellipse(mk.x, mk.y + 1, 7, 3.5).stroke({ width: 1, color: MARK, alpha: 0.5 });
    } else {
      this._marker = null;
    }

    // You: a thick gold ring with a facing notch, and an arrow overhead.
    const pulse = still ? 0 : 0.5 + 0.5 * Math.sin(t * 4);
    const sc = this.sc;
    g.circle(human.x, human.y, 20 * sc).fill({ color: GOLD, alpha: 0.12 });
    g.circle(human.x, human.y, 20 * sc).stroke({ width: 3, color: GOLD, alpha: 0.95 });
    g.circle(human.x, human.y, (23 + pulse * 1.5) * sc).stroke({ width: 1, color: GOLD_HOT, alpha: 0.35 });
    const f = human.facing || 0;
    const tip = { x: human.x + Math.cos(f) * 27 * sc, y: human.y + Math.sin(f) * 27 * sc };
    const lft = { x: human.x + Math.cos(f - 0.28) * 21 * sc, y: human.y + Math.sin(f - 0.28) * 21 * sc };
    const rgt = { x: human.x + Math.cos(f + 0.28) * 21 * sc, y: human.y + Math.sin(f + 0.28) * 21 * sc };
    g.poly([tip.x, tip.y, lft.x, lft.y, rgt.x, rgt.y]).fill({ color: GOLD, alpha: 0.95 });

    const bob = still ? 0 : Math.sin(t * 5) * 1.5;
    const ay = human.y - 30 * sc + bob;
    o.poly([human.x - 6 * sc, ay - 7 * sc, human.x + 6 * sc, ay - 7 * sc, human.x, ay]).fill({ color: GOLD_HOT })
      .stroke({ width: 1.5, color: 0x2a1a05, alpha: 0.9 });
  }

  _drawFlashes(o, still) {
    let label = null;
    for (const f of this.flashes) {
      const k = f.age / FLASH_LIFE;
      const e = easeOutCubic(k);
      if (!still) {
        o.circle(f.x, f.y, 14 + 26 * e).stroke({ width: 4 * (1 - k) + 1, color: LOCK, alpha: 0.9 * (1 - k) });
        o.circle(f.x, f.y, 16).fill({ color: 0xffffff, alpha: 0.45 * (1 - k) * (1 - k) });
      } else {
        o.circle(f.x, f.y, 26).stroke({ width: 3, color: LOCK, alpha: 0.9 * (1 - k) });
      }
      label = { x: f.x, y: f.y - 30 - (still ? 0 : 8 * e), a: 1 - k * k };
    }
    if (label) {
      this.flashText.visible = true;
      this.flashText.x = label.x;
      this.flashText.y = label.y;
      this.flashText.alpha = label.a;
    } else {
      this.flashText.visible = false;
    }
  }

  destroy() {
    this.floor.destroy();
    this.over.destroy();
    this.flashText.destroy();
    this.ghosts = [];
    this.trails.clear();
    this.flashes = [];
  }
}

export default CourtGuides;
