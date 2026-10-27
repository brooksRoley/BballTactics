// PlayerFigure.js
// -----------------------------------------------------------------------------
// A procedural top-down basketball player for CourtRenderer: shoulders in the
// team jersey, a head, two arms with hands, two sneakers, a floor shadow and an
// upright nameplate. No image assets.
//
// Every part is a Graphics built once; a pose only moves, rotates and scales
// them, so ten figures cost no geometry rebuilds per frame.
//
// Local frame: the rig faces +x; +y is the player's right hand (screen y runs
// down). `update()` takes a pose:
//   { facing, speed, action, t, kind, carrier, human, still }
// where action is idle | run | dribble | shoot | reach | dash | celebrate | guard
// (see client/moba/anim.js).
// -----------------------------------------------------------------------------

import { Container, Graphics, Text } from 'pixi.js';

const SKIN = [0x5a3a26, 0x7a4e32, 0x9c6b47, 0xc28e68];
const HAIR = 0x1d1410;
const SHOE = 0x15181d;
const SHOULDER = 10.5;   // half shoulder width, px
const ARM_W = 4.4;         // arm thickness
const HAND_R = 2.6;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

/** Shortest signed angle from a to b. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Ease `cur` toward `target` angle at `rate` per second (framerate-independent). */
export function turnToward(cur, target, rate, dt) {
  const k = 1 - Math.exp(-rate * dt);
  return cur + angleDelta(cur, target) * k;
}

const hashId = (id) => {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

function makeArm(skin) {
  const arm = new Container();
  const limb = new Graphics();
  // Drawn 10px long; scale.x sets the reach, the hand rides at the end.
  limb.roundRect(0, -ARM_W / 2, 10, ARM_W, ARM_W / 2).fill({ color: skin });
  limb.roundRect(0, -ARM_W / 2, 10, ARM_W, ARM_W / 2).stroke({ width: 1, color: 0x000000, alpha: 0.55 });
  const hand = new Graphics();
  hand.circle(0, 0, HAND_R).fill({ color: skin });
  hand.circle(0, 0, HAND_R).stroke({ width: 1, color: 0x000000, alpha: 0.55 });
  arm.addChild(limb, hand);
  arm._limb = limb;
  arm._hand = hand;
  return arm;
}

function setArm(arm, angle, len) {
  arm.rotation = angle;
  arm._limb.scale.x = Math.max(0.1, len / 10);
  arm._hand.x = len;
}

export class PlayerFigure {
  /**
   * @param {object} o
   * @param {number} o.color  jersey colour
   * @param {number} o.light  jersey highlight colour
   * @param {number} o.trim   jersey trim colour
   * @param {*}      o.id     player id (picks a skin tone)
   */
  constructor({ color, light, trim, id, labelLayer = null }) {
    this.node = new Container();
    const skin = SKIN[hashId(id) % SKIN.length];

    this.shadow = new Graphics();
    this.shadow.ellipse(0, 0, 14, 9).fill({ color: 0x000000, alpha: 0.3 });
    this.shadow.ellipse(0, 0, 9, 6).fill({ color: 0x000000, alpha: 0.18 });
    this.shadow.y = 5;

    this.rig = new Container();
    this.feet = [new Graphics(), new Graphics()];
    for (const f of this.feet) f.roundRect(-3.5, -2.2, 7, 4.4, 2.2).fill({ color: SHOE });

    this.armL = makeArm(skin);
    this.armR = makeArm(skin);
    this.armL.y = -SHOULDER + 1.5;
    this.armR.y = SHOULDER - 1.5;

    this.torso = new Graphics();
    this.trimColor = trim;
    this._drawTorso(color, light, trim, 1.6);

    this.head = new Graphics();
    // Seen from above: a skin-toned head with short hair over the crown and
    // back, and two ears, so it reads as a head and not a dot.
    this.head.circle(0, -5, 1.6).fill({ color: skin }).circle(0, 5, 1.6).fill({ color: skin });
    this.head.circle(0, 0, 5.2).fill({ color: skin });
    this.head.ellipse(-1.1, 0, 4, 4.5).fill({ color: HAIR, alpha: 0.9 });
    this.head.circle(0, 0, 5.2).stroke({ width: 0.9, color: 0x000000, alpha: 0.45 });
    this.head.x = 0.6;

    this.rig.addChild(this.feet[0], this.feet[1], this.armL, this.armR, this.torso, this.head);

    this.label = new Text({
      text: '',
      style: {
        fontFamily: 'Arial, sans-serif', fontSize: 9, fontWeight: '800', fill: 0xffffff,
        stroke: { color: 0x0b0f17, width: 3 }, align: 'center', letterSpacing: 0.3,
      },
    });
    this.label.anchor.set(0.5, 0);
    this.label.y = 15;

    // Nameplates go in their own layer above every figure when one is given,
    // so a neighbour's body never covers a name.
    this._ownLabel = !labelLayer;
    this.node.addChild(this.shadow, this.rig);
    if (labelLayer) labelLayer.addChild(this.label);
    else this.node.addChild(this.label);

    this.facing = null;     // smoothed render facing (radians)
    this.stride = 0;        // running phase
    this.human = false;
    this.base = { color, light, trim };
  }

  _drawTorso(color, light, trim, trimW) {
    const g = this.torso;
    g.clear();
    // Shoulders: wider across (y) than deep (x), a jersey with a lit top.
    // Shoulders: a capsule across the body (y), shallow front to back (x),
    // squared a touch at the chest so the facing reads.
    const w = SHOULDER + 2;
    g.roundRect(-6, -w, 12, w * 2, 6).fill({ color });
    g.roundRect(-6, -w, 12, w * 2, 6).stroke({ width: trimW, color: trim, alpha: 0.95 });
    // Lit upper back and a jersey neckline in front of the head.
    g.roundRect(-5, -w + 3, 5, w * 2 - 6, 2.5).fill({ color: light, alpha: 0.35 });
    g.moveTo(3.5, -4.5).quadraticCurveTo(7, 0, 3.5, 4.5).stroke({ width: 1.4, color: trim, alpha: 0.85 });
  }

  /** The human's figure: a brighter jersey with a thick white-and-gold trim. */
  setHuman(on) {
    if (this.human === on) return;
    this.human = on;
    const { color, light, trim } = this.base;
    this._drawTorso(color, on ? 0xffffff : light, on ? 0xffffff : trim, on ? 2.6 : 1.6);
    if (on) {
      this.torso.ellipse(0, 0, 5.4, SHOULDER - 0.6).stroke({ width: 1.4, color: 0xf2b45f, alpha: 1 });
    }
    this.label.style.fill = on ? 0xffd27a : 0xffffff;
    this.label.style.fontSize = on ? 10 : 9;
    this.label.style.stroke = { color: on ? 0x2a1a05 : 0x0b0f17, width: 3 };
  }

  setLabel(text, visible = true) {
    if (this.label.text !== text) this.label.text = text;
    this.label.visible = visible;
  }

  /** World position of the right hand, for the dribble. */
  handWorld() {
    const a = this.rig.rotation;
    const s = this.rig.scale.x;
    const arm = this.armR;
    const lx = this.rig.x + (arm.x + Math.cos(arm.rotation) * arm._hand.x) * s;
    const ly = (arm.y + Math.sin(arm.rotation) * arm._hand.x) * s;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    return {
      x: this.node.x + (lx * ca - ly * sa) * this.node.scale.x,
      y: this.node.y + (this.rig.y + lx * sa + ly * ca) * this.node.scale.y,
    };
  }

  update(pose, dt, nowMs) {
    const still = !!pose.still;
    const target = pose.facing;
    if (this.facing == null) this.facing = target;
    const quick = pose.action === 'dash' || pose.action === 'reach' || pose.action === 'shoot';
    this.facing = still ? target : turnToward(this.facing, target, quick ? 30 : 12, dt);

    const speed = pose.speed || 0;
    const moving = speed > 18;
    if (moving && !still) this.stride += dt * clamp(speed / 160, 0.6, 1.6) * 11;
    const s = Math.sin(this.stride);

    // Defaults: standing, arms hanging (short from above), feet under the hips.
    let scale = 1;
    let lean = 0;          // px forward along facing
    let shadowLift = 0;    // 0..1, how far the body is off the floor
    let aL = -0.45, lenL = 7;
    let aR = 0.45, lenR = 7;
    let fx0 = 1.5, fy0 = -4.5, fx1 = 1.5, fy1 = 4.5;
    let wobble = 0;

    if (moving) {
      const sw = still ? 0 : s;
      aL = -0.3 + 0.55 * sw; lenL = 7.5;
      aR = 0.3 + 0.55 * sw; lenR = 7.5;
      fx0 = 5 * sw; fx1 = -5 * sw;
      scale = 1 + (still ? 0 : 0.035 * Math.abs(s));
      lean = 1;
    }

    const t = pose.t || 0;
    switch (pose.action) {
      case 'dribble': {
        // Ball hand pumps out to the side and front; the off arm shields.
        const pump = still ? 0.5 : Math.abs(Math.sin((nowMs / 1000) * 2.4 * Math.PI));
        aR = 0.75; lenR = 10 + 1.5 * pump;
        aL = -0.55; lenL = 9;
        break;
      }
      case 'guard':
        // Sit down, arms wide, feet wide: a closeout lean.
        scale = 0.95;
        lean = 2.5;
        aL = -1.15; lenL = 12;
        aR = 1.15; lenR = 12;
        fy0 = -7; fy1 = 7; fx0 = moving ? fx0 : 0; fx1 = moving ? fx1 : 0;
        break;
      case 'shoot': {
        // Crouch (0-0.18), rise to the top of the jump (0.18-0.55), land.
        let k;
        if (t < 0.18) k = -t / 0.18;
        else if (t < 0.55) k = Math.sin(((t - 0.18) / 0.37) * Math.PI * 0.5);
        else k = 1 - (t - 0.55) / 0.45;
        k = still ? 0 : k;
        scale = 1 + (k < 0 ? 0.1 * k : 0.2 * k);
        shadowLift = Math.max(0, k);
        aL = -0.22; lenL = t < 0.18 ? 7 : 12;
        aR = 0.15; lenR = t < 0.18 ? 7 : 14;   // shooting hand follows through
        fx0 = fx1 = 0; fy0 = -3.5; fy1 = 3.5;
        break;
      }
      case 'reach': {
        const lunge = Math.sin(Math.PI * clamp(t, 0, 1));
        lean = 6 * lunge;
        aR = 0.1; lenR = 9 + 9 * lunge;   // the poke
        aL = 2.3; lenL = 6;               // back arm for balance
        fx0 = 6; fx1 = -6; fy0 = -4; fy1 = 4;
        break;
      }
      case 'dash':
        if (pose.kind === 'closeout') {
          lean = 4;
          aL = -0.32; lenL = 14;  // both hands up at the shooter
          aR = 0.32; lenR = 14;
          fx0 = 6; fx1 = -6;
        } else {
          lean = -3;              // step-back: weight back, arms out for balance
          aL = -1.5; lenL = 9;
          aR = 1.1; lenR = 9;
          fx0 = -6; fx1 = 2;
        }
        break;
      case 'celebrate': {
        const pop = still ? 0 : Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t);
        scale = 1 + 0.16 * pop;
        shadowLift = pop;
        aL = -0.75; lenL = 14;
        aR = 0.75; lenR = 14;
        wobble = still ? 0 : 0.25 * Math.sin(t * Math.PI * 4) * (1 - t);
        break;
      }
      default:
        break;
    }

    const human = this.human ? 1.08 : 1;
    this.rig.rotation = this.facing + wobble;
    this.rig.scale.set(scale * human);
    this.rig.x = Math.cos(this.facing) * lean;
    this.rig.y = Math.sin(this.facing) * lean;
    setArm(this.armL, aL, lenL);
    setArm(this.armR, aR, lenR);
    this.feet[0].x = fx0; this.feet[0].y = fy0;
    this.feet[1].x = fx1; this.feet[1].y = fy1;

    // Off the floor: the shadow slides down and shrinks.
    this.shadow.y = 5 + 7 * shadowLift;
    this.shadow.scale.set(lerp(1, 0.7, shadowLift) * human);
    this.shadow.alpha = lerp(1, 0.6, shadowLift);
    const off = this.human ? -52 : 15 + 2 * shadowLift;
    if (this._ownLabel) {
      this.label.y = off;
    } else {
      this.label.x = this.node.x;
      this.label.y = this.node.y + off * this.node.scale.y;
      this.label.scale.set(this.node.scale.x);
    }
  }

  destroy() {
    if (!this._ownLabel) this.label.destroy();
    this.node.destroy({ children: true });
  }
}

export default PlayerFigure;
