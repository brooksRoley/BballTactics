// CourtFx.js
// -----------------------------------------------------------------------------
// Game-feel effects for the Pixi fight court: rim ripples + net flick on a make,
// backboard shudder on a miss, a dust puff on a steal, rising "+2/+3" floaters
// and trauma-based screen shake. Every number comes from FEEL (client/fx/feel.js);
// the math reuses its Shake / ParticlePool / easing helpers.
//
// Owned by CourtRenderer: effects draw into its `fxLayer` and the shake is an
// offset on its `world` container. Presentation only — it is told about events
// (see client/game/events.js) and never touches the simulation.
//
//   const fx = new CourtFx(fxLayer, world);
//   fx.trigger({ type: 'make', points: 3, team: 'home', hoop: {x, y}, at: {x, y} });
//   fx.update(dtSeconds);   // once per rendered frame
//   fx.destroy();
// -----------------------------------------------------------------------------

import { Container, Graphics, Text } from 'pixi.js';
import {
  FEEL, Shake, ParticlePool, spawnDust, easeOutCubic, easeOutBack, prefersReducedMotion,
} from '../fx/feel.js';

const rgb = ([r, g, b]) => (r << 16) | (g << 8) | b;
const MAX_TIMED = 4; // concurrent ripples / flicks / shudders kept at once

// Backboards sit 10px in from each baseline (see CourtRenderer._buildCourt).
const BOARD_INSET = 10;
const BOARD_HALF = 20;
const RIM_R = 9;

export class CourtFx {
  constructor(fxLayer, world) {
    this.world = world;
    this.shake = new Shake(FEEL.shake);
    this.dust = new ParticlePool(FEEL.particles.maxActive);
    this.ripples = [];   // { x, y, age, reduced }
    this.nets = [];      // { x, y, age }
    this.boards = [];    // { x, y, age, reduced }
    this.floaters = [];  // { node, x, y, vy, age, reduced }

    // One Graphics for every vector effect, redrawn only while something is live.
    // It sits under the ball (index 0 in the fx layer); floaters sit on top.
    this.gfx = new Graphics();
    fxLayer.addChildAt(this.gfx, 0);
    this._drawn = false;

    // Fixed pool of floater labels: text changes only on a make, colour is a tint.
    this.floaterLayer = new Container();
    fxLayer.addChild(this.floaterLayer);
    this._freeFloaters = [];
    for (let i = 0; i < FEEL.floaters.maxActive; i++) {
      const t = new Text({
        text: '+2',
        style: {
          fontFamily: 'Arial, sans-serif', fontSize: FEEL.floaters.fontPx, fontWeight: '900',
          fill: 0xffffff, stroke: { color: 0x1a0f05, width: 4 },
        },
      });
      t.anchor.set(0.5);
      t.visible = false;
      this.floaterLayer.addChild(t);
      this._freeFloaters.push(t);
    }
  }

  trigger(e) {
    if (!e || !e.type) return;
    const reduced = prefersReducedMotion();
    const w = FEEL.shake.weights;
    switch (e.type) {
      case 'make':
        if (e.hoop) {
          this._push(this.ripples, { x: e.hoop.x, y: e.hoop.y, age: 0, reduced });
          if (!reduced) this._push(this.nets, { x: e.hoop.x, y: e.hoop.y, age: 0 });
        }
        if (e.at) this._spawnFloater(`+${e.points}`, e.team, e.at, reduced);
        this.shake.add(e.points >= 3 ? w.three : w.score);
        break;
      case 'miss':
        if (e.hoop) this._push(this.boards, { x: e.hoop.x, y: e.hoop.y, age: 0, reduced });
        this.shake.add(w.miss);
        break;
      case 'steal':
        if (e.at) spawnDust(this.dust, e.at.x, e.at.y); // the pool skips this under reduced motion
        this.shake.add(w.steal);
        break;
      case 'gameWinner':
        if (e.hoop) this._push(this.ripples, { x: e.hoop.x, y: e.hoop.y, age: 0, reduced });
        this.shake.add(w.gameWinner);
        break;
      default:
        break;
    }
  }

  update(dt) {
    this._updateShake(dt);
    this._updateFloaters(dt);
    if (this.dust.length) this.dust.update(dt);

    const live = this.ripples.length || this.nets.length || this.boards.length || this.dust.length;
    if (!live) {
      if (this._drawn) { this.gfx.clear(); this._drawn = false; }
      return;
    }
    const g = this.gfx;
    g.clear();
    this._drawn = true;
    this._drawRipples(g, dt);
    this._drawNets(g, dt);
    this._drawBoards(g, dt);
    this._drawDust(g);
  }

  destroy() {
    if (this.world) { this.world.x = 0; this.world.y = 0; }
    this.gfx.destroy();
    this.floaterLayer.destroy({ children: true });
    this.ripples = this.nets = this.boards = this.floaters = this._freeFloaters = [];
    this.dust.items = [];
    this.world = null;
  }

  // --- internals -------------------------------------------------------------

  _push(list, item) {
    if (list.length >= MAX_TIMED) list.shift();
    list.push(item);
  }

  _updateShake(dt) {
    this.shake.update(dt);
    if (!this.world) return;
    if (this.shake.trauma < 0.002) {
      if (this.world.x !== 0 || this.world.y !== 0) { this.world.x = 0; this.world.y = 0; }
      return;
    }
    this.world.x = this.shake.offsetX;
    this.world.y = this.shake.offsetY;
  }

  _spawnFloater(text, team, at, reduced) {
    let node = this._freeFloaters.pop();
    if (!node) {
      // At the cap: recycle the oldest live floater.
      const oldest = this.floaters.shift();
      if (!oldest) return;
      node = oldest.node;
    }
    if (node.text !== text) node.text = text;
    node.tint = team === 'home' ? FEEL.floaters.homeColor : FEEL.floaters.awayColor;
    node.visible = true;
    node.alpha = 1;
    node.scale.set(reduced ? 1 : FEEL.floaters.popScale);
    node.x = at.x;
    node.y = at.y - 18;
    this.floaters.push({ node, y: node.y, vy: FEEL.floaters.launchVy, age: 0, reduced });
  }

  _updateFloaters(dt) {
    if (!this.floaters.length) return;
    const cfg = FEEL.floaters;
    let write = 0;
    for (let i = 0; i < this.floaters.length; i++) {
      const f = this.floaters[i];
      f.age += dt;
      if (f.age >= cfg.life) {
        f.node.visible = false;
        this._freeFloaters.push(f.node);
        continue;
      }
      const t = f.age / cfg.life;
      if (!f.reduced) {
        f.vy += cfg.gravity * dt;
        f.y += f.vy * dt;
        f.node.y = f.y;
        const u = Math.min(1, f.age / cfg.popTime);
        f.node.scale.set(cfg.popScale + (1 - cfg.popScale) * easeOutBack(u));
      }
      f.node.alpha = 1 - t * t;
      this.floaters[write++] = f;
    }
    this.floaters.length = write;
  }

  // Age every item in a timed list; drop the ones past `life(item)`.
  _age(list, dt, life) {
    let write = 0;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      it.age += dt;
      if (it.age < life(it)) list[write++] = it;
    }
    list.length = write;
  }

  _drawRipples(g, dt) {
    const cfg = FEEL.rim;
    const color = rgb(cfg.rippleColor);
    const stagger = cfg.rippleDuration * 0.2;
    this._age(this.ripples, dt, (r) => (r.reduced ? cfg.reducedFade : cfg.rippleDuration + stagger * (cfg.rippleRings - 1)));
    for (const r of this.ripples) {
      if (r.reduced) {
        // A single still ring that fades — the make still reads, nothing moves.
        const a = 1 - r.age / cfg.reducedFade;
        g.circle(r.x, r.y, cfg.rippleMaxRadius * 0.5).stroke({ width: 2, color, alpha: 0.8 * a });
        continue;
      }
      for (let i = 0; i < cfg.rippleRings; i++) {
        const t = (r.age - i * stagger) / cfg.rippleDuration;
        if (t <= 0 || t >= 1) continue;
        const reach = (i + 1) / cfg.rippleRings;
        const radius = RIM_R + (cfg.rippleMaxRadius - RIM_R) * reach * easeOutCubic(t);
        g.circle(r.x, r.y, radius).stroke({ width: 0.8 + 2.4 * (1 - t), color, alpha: 0.85 * (1 - t) });
      }
    }
  }

  _drawNets(g, dt) {
    const cfg = FEEL.rim;
    this._age(this.nets, dt, () => cfg.netFlickDuration);
    for (const n of this.nets) {
      const t = n.age / cfg.netFlickDuration;
      const env = (1 - t) * (1 - t);
      const swing = cfg.netFlickAmp * env * Math.sin(n.age * cfg.netFlickFreq);
      for (let k = 0; k < cfg.netStrands; k++) {
        const a = (k / cfg.netStrands) * Math.PI * 2;
        const cx = Math.cos(a);
        const sy = Math.sin(a);
        const reach = RIM_R + cfg.netLength * (0.6 + 0.4 * env);
        // Strands whip sideways (perpendicular to their own direction).
        g.moveTo(n.x + cx * RIM_R, n.y + sy * RIM_R)
          .lineTo(n.x + cx * reach - sy * swing, n.y + sy * reach + cx * swing)
          .stroke({ width: 1.5, color: 0xffffff, alpha: 0.75 * (1 - t) });
      }
    }
  }

  _drawBoards(g, dt) {
    const cfg = FEEL.rim;
    this._age(this.boards, dt, (b) => (b.reduced ? cfg.reducedFade : cfg.boardShudderDuration));
    for (const b of this.boards) {
      const life = b.reduced ? cfg.reducedFade : cfg.boardShudderDuration;
      const t = b.age / life;
      const left = b.x < 400;
      const baseX = left ? BOARD_INSET : 800 - BOARD_INSET;
      const off = b.reduced ? 0
        : cfg.boardShudderAmp * (1 - t) * (1 - t) * Math.sin(b.age * cfg.boardShudderFreq) * (left ? 1 : -1);
      g.moveTo(baseX + off, b.y - BOARD_HALF).lineTo(baseX + off, b.y + BOARD_HALF)
        .stroke({ width: 3.5, color: 0xffffff, alpha: 0.95 * (1 - t) });
    }
  }

  _drawDust(g) {
    const items = this.dust.items;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      const t = p.age / p.life;
      g.circle(p.x, p.y, p.size * (1 - t * 0.5)).fill({ color: rgb(p.color), alpha: (1 - t) * (p.alpha ?? 0.8) });
    }
  }
}

export default CourtFx;
