/**
 * anim.js — what each Full Court player is *doing*, for the renderer.
 *
 * Reads match state and never writes it: no RNG draws, no rule numbers, so a
 * match plays out identically whether or not anything looks at it. view()
 * attaches the result to each player frame as `anim`.
 *
 *   { facing, vx, vy, action, t, kind?, buffs, locked, guarding }
 *
 *   facing  radians, 0 = +x (toward the home rim), y down
 *   vx, vy  px/s the player is trying to move this tick
 *   action  idle | run | dribble | shoot | reach | dash | celebrate | guard
 *   t       0..1 progress through a timed action (shoot, reach, dash, celebrate)
 *   kind    for a dash: 'stepback' | 'closeout'
 */

const RIM = { home: { x: 780, y: 200 }, away: { x: 20, y: 200 } };
const STEPBACK_DASH = 0.18;   // match.js cast(): dash.t for the step-back
const CLOSEOUT_DASH = 0.22;   // match.js cast(): dash.t for the closeout
const SHOT_POSE = 0.55;       // s the jump-shot pose lasts after release
const REACH_POSE = 0.32;      // s the steal lunge lasts
const CELEBRATE = 1.1;        // s a scorer celebrates
const RUN_EPS = 18;           // px/s below this reads as standing

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

/** The speed a player moves at this tick, mirroring match.js speedOf(). */
function speedNow(m, p) {
  let bonus = 0;
  if (p.buffs.burstUntil > m.time) bonus += p.buffs.burstBonus;
  const tb = m.teamBuffs[p.team];
  if (tb && tb.fastUntil > m.time) bonus += tb.fastBonus;
  let s = p.baseSpeed * (1 + bonus);
  if (m.ball.holder === p.id && m.ball.state === 'held') s *= 0.9;
  if (p.stamina < 10) s *= 0.85;
  return s;
}

/** Where a player would face standing still: the ball, or their rim with it. */
function restFacing(m, p, carrier) {
  if (carrier === p) return angleTo(p.pos, RIM[p.team]);
  const ballAt = carrier ? carrier.pos : m.ball.pos;
  if (ballAt && (ballAt.x !== p.pos.x || ballAt.y !== p.pos.y)) return angleTo(p.pos, ballAt);
  return p.team === 'home' ? 0 : Math.PI;
}

/** The animation state for one player. Pure. */
export function animFor(m, p) {
  const carrier = m.ball.state === 'held' ? m.byId.get(m.ball.holder) : null;
  const live = m.phase === 'live';

  // Intended velocity.
  let vx = 0;
  let vy = 0;
  if (live && p.dash) {
    vx = p.dash.vx;
    vy = p.dash.vy;
  } else if (live && p.target) {
    const dx = p.target.x - p.pos.x;
    const dy = p.target.y - p.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.5) {
      // Close to the target the step shrinks, so arrival reads as stopping.
      const s = Math.min(speedNow(m, p), d * 8);
      vx = (dx / d) * s;
      vy = (dy / d) * s;
    }
  }
  const speed = Math.hypot(vx, vy);

  let facing = speed > RUN_EPS ? Math.atan2(vy, vx) : restFacing(m, p, carrier);
  let action = speed > RUN_EPS ? 'run' : 'idle';
  let t = 0;
  let kind;

  if (carrier === p) action = 'dribble';

  // Guarding the ball: the defender on the carrier sits down in a stance.
  if (carrier && carrier.team !== p.team && !p.dash) {
    const man = m.teams[carrier.team][p.idx];
    const d = Math.hypot(carrier.pos.x - p.pos.x, carrier.pos.y - p.pos.y);
    if (man === carrier && d < 60) {
      action = 'guard';
      facing = angleTo(p.pos, carrier.pos);
    }
  }

  // Timed actions win over locomotion, latest first.
  const lm = m.lastMake;
  if (lm && lm.id === p.id && m.time - lm.at < CELEBRATE) {
    action = 'celebrate';
    t = clamp((m.time - lm.at) / CELEBRATE, 0, 1);
  }
  const reachMax = p.isHuman ? 1.5 : 1.2;
  if (p.stealCd > 0 && reachMax - p.stealCd < REACH_POSE) {
    action = 'reach';
    t = clamp((reachMax - p.stealCd) / REACH_POSE, 0, 1);
    const target = carrier && carrier.team !== p.team ? carrier.pos : m.ball.pos;
    if (target) facing = angleTo(p.pos, target);
  }
  const shot = m.ball.state === 'shot' ? m.ball.shot : null;
  if (shot && shot.shooterId === p.id && shot.t < SHOT_POSE) {
    action = 'shoot';
    t = clamp(shot.t / SHOT_POSE, 0, 1);
    facing = angleTo(shot.from, shot.rim);
  }
  if (live && p.dash) {
    action = 'dash';
    kind = p.dash.closeout ? 'closeout' : 'stepback';
    const total = p.dash.closeout ? CLOSEOUT_DASH : STEPBACK_DASH;
    t = clamp(1 - p.dash.t / total, 0, 1);
    // A step-back moves away from where the player keeps looking.
    facing = kind === 'stepback' ? Math.atan2(-vy, -vx) : Math.atan2(vy, vx);
  }

  const time = m.time;
  const tb = m.teamBuffs[p.team];
  const buffs = {
    burst: Math.max(0, p.buffs.burstUntil - time),
    limitless: Math.max(0, p.buffs.limitlessUntil - time),
    stepback: Math.max(0, p.buffs.stepbackUntil - time),
    fastbreak: tb ? Math.max(0, tb.fastUntil - time) : 0,
    wall: Math.max(0, ...m.zones.filter((z) => z.ownerId === p.id).map((z) => z.until - time), 0),
  };

  return {
    facing,
    vx,
    vy,
    action,
    t,
    ...(kind ? { kind } : {}),
    buffs,
    locked: !!(p.lock && p.lock.until > time),
    guarding: action === 'guard',
    defense: m.offense !== p.team,
  };
}
