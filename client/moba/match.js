/**
 * match.js — Full Court rules: a seeded 5v5 full-court game where one player
 * is human-controlled (right-click move, Q/W/E/R, Space to shoot, left-click
 * to pass or reach) and the other nine are AI.
 *
 * Pure and deterministic for a given seed and command sequence: no DOM, no
 * Vue, runs under plain `node`. The view() it returns uses the same
 * { players, bots, ball } shape as GameManager.GetGameStateJSON(), so
 * CourtRenderer draws it unchanged; the extra `hud` and `overlay` fields are
 * what only this mode needs. See docs/design/full-court.md.
 */

import { mulberry32 } from '../game/fallbackSim.js';
import { buildKit, moveSpeed, stat, SLOTS } from './kits.js';

export const COURT_W = 800;
export const COURT_H = 400;
const MID_X = COURT_W / 2;

// Rims match CourtRenderer's drawn hoops. Home attacks right, away attacks left.
const RIM = { home: { x: COURT_W - 20, y: COURT_H / 2 }, away: { x: 20, y: COURT_H / 2 } };
const THREE_DIST = 160;
const TICK = 1 / 60;

const SHOT_CLOCK = 14;
const STAMINA_MAX = 100;
const STAMINA_REGEN = 6;     // per second
const SEPARATION = 24;       // players closer than this get pushed apart
const PICKUP_RADIUS = 16;
const STEAL_RANGE = 34;
const HUMAN_STEAL_CD = 1.5;
const PASS_SPEED = 560;
const INTERCEPT_RADIUS = 14;
const BREAK_SECONDS = 2.5;
const OVERTIME_SECONDS = 20;

// Offensive spots for a team attacking the right rim; away mirrors x.
const SPOTS = [
  { x: 590, y: 200 }, // top
  { x: 650, y: 95 },  // left wing
  { x: 650, y: 305 }, // right wing
  { x: 755, y: 45 },  // left corner
  { x: 755, y: 355 }, // right corner
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const grade = (v) => clamp((v - 25) / 55, 0, 1);
const other = (team) => (team === 'home' ? 'away' : 'home');

/** Distance from point p to segment ab. */
function segDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Split the roster into two balanced fives. The human's player leads home;
 * the rest are shuffled by seed, then each goes to whichever side has the
 * lower total cost while it still has room.
 */
export function pickTeams(roster, humanId, seed = 1) {
  const rng = mulberry32(seed ^ 0x5eed);
  const human = roster.find((p) => p.id === humanId);
  if (!human) throw new Error(`No roster player with id ${humanId}`);
  const pool = roster.filter((p) => p.id !== humanId && p.is_active !== false);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  pool.sort((a, b) => (b.cost || 1) - (a.cost || 1));
  const home = [human];
  const away = [];
  const cost = (team) => team.reduce((s, p) => s + (p.cost || 1), 0);
  for (const p of pool) {
    if (home.length === 5 && away.length === 5) break;
    if (home.length === 5) away.push(p);
    else if (away.length === 5) home.push(p);
    else if (cost(home) <= cost(away)) home.push(p);
    else away.push(p);
  }
  if (home.length < 5 || away.length < 5) throw new Error('Full Court needs at least 10 active players');
  return { home, away };
}

/** Chance a shot from `at` goes in, before the roll. Exported for tests. */
export function shotChance(m, shooter, at = shooter.pos) {
  const rim = RIM[shooter.team];
  const d = dist(at, rim);
  const sh = grade(stat(shooter, 'shooting'));
  const limitless = shooter.buffs.limitlessUntil > m.time;

  let p = lerp(0.46, 0.66, sh);
  if (d < 60) p += 0.12;                       // at the rim
  else if (d <= THREE_DIST) p *= 0.86;         // mid-range
  else if (limitless) p *= 0.82;               // any three, no deep penalty
  else p *= d > 240 ? 0.42 : 0.66;             // three; heaves fall off fast

  let contest = 0;
  for (const def of m.teams[other(shooter.team)]) {
    const cd = dist(def.pos, at);
    if (cd >= 50) continue;
    const c = ((50 - cd) / 50) * lerp(0.18, 0.42, grade(stat(def, 'defense')));
    contest = Math.max(contest, c);
  }
  if (shooter.lock && shooter.lock.until > m.time) contest += shooter.lock.contestBonus;
  if (shooter.buffs.stepbackUntil > m.time) contest *= 1 - shooter.buffs.stepbackIgnore;
  p *= 1 - clamp(contest, 0, 0.85);

  for (const z of m.zones) {
    if (z.team !== shooter.team && z.until > m.time && dist(z.center(), at) <= z.radius) p *= 1 - z.penalty;
  }
  return clamp(p, 0.03, 0.9);
}

const shotPoints = (shooter, at) => (dist(at, RIM[shooter.team]) > THREE_DIST ? 3 : 2);

/**
 * Create a match. `roster` is the engine_roster.json array, `humanId` the
 * player the human picked. Options: seed, quarterLength (s), quarters.
 */
export function createMatch({ roster, humanId, seed = 1, quarterLength = 45, quarters = 4 }) {
  const rng = mulberry32(seed);
  const split = pickTeams(roster, humanId, seed);

  const makePlayer = (src, team, idx) => ({
    id: src.id,
    name: src.name,
    team,
    idx,
    stats: src.stats,
    kit: buildKit(src),
    baseSpeed: moveSpeed(src),
    isHuman: src.id === humanId,
    pos: { x: 0, y: 0 },
    target: null,
    dash: null,
    stamina: STAMINA_MAX,
    cd: { Q: 0, W: 0, E: 0, R: 0 },
    buffs: { burstUntil: 0, burstBonus: 0, limitlessUntil: 0, stepbackUntil: 0, stepbackIgnore: 0 },
    lock: null,
    stealCd: 0,
    think: rng() * 0.4,
    cutUntil: 0,
    line: { pts: 0, fga: 0, fgm: 0, ast: 0, stl: 0, reb: 0, to: 0 },
  });

  const m = {
    rng,
    time: 0,
    acc: 0,
    quarter: 1,
    quarters,
    quarterLength,
    clock: quarterLength,
    shotClock: SHOT_CLOCK,
    phase: 'live',          // live | break | final
    breakLeft: 0,
    offense: 'home',
    score: { home: 0, away: 0 },
    teams: {
      home: split.home.map((p, i) => makePlayer(p, 'home', i)),
      away: split.away.map((p, i) => makePlayer(p, 'away', i)),
    },
    ball: { state: 'held', holder: null, pos: { x: 0, y: 0 }, z: 0 },
    teamBuffs: { home: { fastUntil: 0, fastBonus: 0 }, away: { fastUntil: 0, fastBonus: 0 } },
    zones: [],
    lastPass: null,
    events: [],
  };
  m.all = [...m.teams.home, ...m.teams.away];
  m.human = m.all.find((p) => p.isHuman);
  m.byId = new Map(m.all.map((p) => [p.id, p]));

  startPeriod(m, 'home');

  return {
    command: (cmd) => command(m, cmd),
    step: (dt) => step(m, dt),
    view: () => view(m),
    drainEvents: () => m.events.splice(0, m.events.length),
    /** Internal state, for tests and the debug overlay. */
    _m: m,
  };
}

// ---------------------------------------------------------------------------
// Periods and possession

function spotFor(team, idx) {
  const s = SPOTS[idx % SPOTS.length];
  return team === 'home' ? { x: s.x, y: s.y } : { x: COURT_W - s.x, y: s.y };
}

function startPeriod(m, offense) {
  m.offense = offense;
  m.shotClock = SHOT_CLOCK;
  m.zones = [];
  m.lastPass = null;
  const dir = offense === 'home' ? 1 : -1;
  // Offense sets up in its own half, defense waits across half court, each
  // across from the man it guards.
  for (const p of m.all) {
    p.target = null;
    p.dash = null;
    p.lock = null;
    const y = SPOTS[p.idx % SPOTS.length].y;
    const depth = 70 + (p.idx % 3) * 25;
    p.pos = p.team === offense ? { x: MID_X - dir * depth, y } : { x: MID_X + dir * (depth - 30), y };
  }
  const carrier = m.teams[offense][0];
  carrier.pos = { x: MID_X - dir * 90, y: COURT_H / 2 };
  giveBall(m, carrier, false);
}

function giveBall(m, p, countsAsChange = true) {
  const changed = countsAsChange && p.team !== m.offense;
  m.ball.state = 'held';
  m.ball.holder = p.id;
  m.ball.pos = { ...p.pos };
  m.ball.z = 0;
  m.ball.pass = null;
  m.ball.shot = null;
  if (changed || !countsAsChange) {
    m.offense = p.team;
    m.shotClock = SHOT_CLOCK;
    m.lastPass = null;
  }
}

function changePossession(m, toTeam, nearPos) {
  // The new offense player nearest the spot takes it (an inbound, abstracted).
  let best = null;
  for (const p of m.teams[toTeam]) {
    const d = dist(p.pos, nearPos);
    if (!best || d < best.d) best = { p, d };
  }
  m.offense = toTeam;
  giveBall(m, best.p, false);
}

const holder = (m) => (m.ball.state === 'held' ? m.byId.get(m.ball.holder) : null);

// ---------------------------------------------------------------------------
// Commands from the human

function emit(m, e) {
  m.events.push({ t: m.time, ...e });
}

function deny(m, reason) {
  emit(m, { type: 'denied', text: reason });
}

function command(m, cmd) {
  if (!cmd || m.phase !== 'live') return;
  const h = m.human;
  const clampPt = (x, y) => ({ x: clamp(x, 12, COURT_W - 12), y: clamp(y, 12, COURT_H - 12) });
  switch (cmd.type) {
    case 'move':
      h.target = clampPt(cmd.x, cmd.y);
      break;
    case 'stop':
      h.target = null;
      break;
    case 'shoot':
      if (holder(m) !== h) return deny(m, 'You need the ball to shoot');
      shoot(m, h);
      break;
    case 'click': {
      // Left click: a teammate means pass (or ask for it); an opponent with
      // the ball means reach for a steal.
      const at = { x: cmd.x, y: cmd.y };
      const target = nearestTo(m.all.filter((p) => p !== h), at, 26);
      const carrier = holder(m);
      if (target && target.team === h.team && (carrier === h || carrier === target)) {
        if (carrier === h) pass(m, h, target);
        else {
          target.callFor = m.time + 1.5;
          emit(m, { type: 'call', text: 'You call for it' });
        }
      } else if (carrier && carrier.team !== h.team && dist(carrier.pos, at) < 40) {
        trySteal(m, h, carrier);
      } else {
        h.target = clampPt(cmd.x, cmd.y);
      }
      break;
    }
    case 'cast':
      cast(m, h, cmd.slot, { x: cmd.x, y: cmd.y });
      break;
    default:
      break;
  }
}

function nearestTo(list, at, radius) {
  let best = null;
  for (const p of list) {
    const d = dist(p.pos, at);
    if (d <= radius && (!best || d < best.d)) best = { p, d };
  }
  return best ? best.p : null;
}

// ---------------------------------------------------------------------------
// Abilities

export function cast(m, p, slot, aim) {
  const a = p.kit[slot];
  if (!a) return false;
  const say = (text) => { if (p.isHuman) deny(m, text); return false; };
  if (p.cd[slot] > 0) return say(`${a.name} is on cooldown`);
  if (p.stamina < a.cost) return say(`Not enough stamina for ${a.name}`);
  if (a.needsBall && holder(m) !== p) return say(`${a.name} needs the ball`);
  if (a.defenseOnly && m.offense === p.team) return say(`${a.name} works on defense`);

  const aimPt = aim && Number.isFinite(aim.x) ? aim : RIM[other(p.team)];
  switch (a.id) {
    case 'stepback': {
      let dx = p.pos.x - aimPt.x;
      let dy = p.pos.y - aimPt.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      p.dash = { vx: (dx * a.distance) / 0.18, vy: (dy * a.distance) / 0.18, t: 0.18 };
      p.target = null;
      p.buffs.stepbackUntil = m.time + 0.18 + a.window;
      p.buffs.stepbackIgnore = a.contestIgnore;
      break;
    }
    case 'burst':
      p.buffs.burstUntil = m.time + a.duration;
      p.buffs.burstBonus = a.speedBonus;
      break;
    case 'closeout': {
      let dx = aimPt.x - p.pos.x;
      let dy = aimPt.y - p.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      const reach = Math.min(len, a.distance);
      dx /= len; dy /= len;
      p.dash = { vx: (dx * reach) / 0.22, vy: (dy * reach) / 0.22, t: 0.22, closeout: a };
      p.target = null;
      break;
    }
    case 'limitless':
      p.buffs.limitlessUntil = m.time + a.duration;
      break;
    case 'fastbreak':
      m.teamBuffs[p.team] = { fastUntil: m.time + a.duration, fastBonus: a.teamSpeedBonus };
      break;
    case 'wall':
      m.zones.push({ team: p.team, ownerId: p.id, until: m.time + a.duration, radius: a.wallRadius, penalty: a.wallPenalty, center: () => p.pos });
      break;
    default:
      return false;
  }
  p.cd[slot] = a.cooldown;
  p.stamina -= a.cost;
  emit(m, { type: 'cast', slot, ability: a.id, playerId: p.id, team: p.team, text: `${p.name}: ${a.name}` });
  return true;
}

function endDash(m, p) {
  const co = p.dash && p.dash.closeout;
  p.dash = null;
  if (!co) return;
  const carrier = holder(m);
  if (carrier && carrier.team !== p.team && dist(carrier.pos, p.pos) <= co.lockRadius) {
    carrier.lock = { until: m.time + co.lockDuration, contestBonus: co.contestBonus, stealBonus: co.stealBonus, by: p.id };
    emit(m, { type: 'lock', playerId: carrier.id, text: `${p.name} closes out on ${carrier.name}` });
  }
}

// ---------------------------------------------------------------------------
// Ball actions

function shoot(m, p) {
  const at = { ...p.pos };
  const chance = shotChance(m, p, at);
  const points = shotPoints(p, at);
  const made = m.rng() < chance;
  const rim = RIM[p.team];
  const d = dist(at, rim);
  p.line.fga += 1;
  m.ball.state = 'shot';
  m.ball.holder = null;
  m.ball.shot = { from: at, rim, t: 0, dur: 0.5 + d / 1400, made, points, shooterId: p.id, team: p.team, chance };
  p.target = null;
  emit(m, { type: 'shot', playerId: p.id, chance, points });
}

function pass(m, from, to) {
  if (to.team !== from.team || to === from) return;
  m.ball.state = 'pass';
  m.ball.holder = null;
  m.ball.pos = { ...from.pos };
  m.ball.z = 10;
  m.ball.pass = { fromId: from.id, toId: to.id, tried: new Set() };
}

function trySteal(m, thief, carrier) {
  if (thief.stealCd > 0) return;
  thief.stealCd = thief.isHuman ? HUMAN_STEAL_CD : 1.2;
  if (dist(thief.pos, carrier.pos) > STEAL_RANGE) {
    if (thief.isHuman) deny(m, 'Too far to reach');
    return;
  }
  let p = 0.12 + 0.15 * grade(stat(thief, 'defense')) - 0.08 * grade(stat(carrier, 'speed'));
  if (carrier.lock && carrier.lock.until > m.time) p += carrier.lock.stealBonus;
  if (!thief.isHuman) p *= 0.6;
  if (m.rng() < clamp(p, 0.03, 0.5)) {
    thief.line.stl += 1;
    carrier.line.to += 1;
    giveBall(m, thief);
    emit(m, { type: 'steal', playerId: thief.id, team: thief.team, at: { ...thief.pos }, text: `${thief.name} steals it from ${carrier.name}` });
  } else if (thief.isHuman) {
    emit(m, { type: 'reach', text: 'Reached in, came up empty' });
  }
}

// ---------------------------------------------------------------------------
// The loop

function step(m, dt) {
  m.acc += Math.min(dt, 0.25);
  while (m.acc >= TICK) {
    m.acc -= TICK;
    tick(m, TICK);
  }
}

function tick(m, dt) {
  m.time += dt;
  if (m.phase === 'final') return;
  if (m.phase === 'break') {
    m.breakLeft -= dt;
    if (m.breakLeft <= 0) {
      m.phase = 'live';
      startPeriod(m, m.quarter % 2 === 1 ? 'home' : 'away');
    }
    return;
  }

  m.clock -= dt;
  if (m.ball.state === 'held') m.shotClock -= dt;

  for (const p of m.all) {
    for (const s of SLOTS) p.cd[s] = Math.max(0, p.cd[s] - dt);
    p.stealCd = Math.max(0, p.stealCd - dt);
    p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_REGEN * dt);
    if (p.lock && p.lock.until <= m.time) p.lock = null;
  }
  m.zones = m.zones.filter((z) => z.until > m.time);

  for (const p of m.all) if (!p.isHuman) think(m, p, dt);
  for (const p of m.all) move(m, p, dt);
  separate(m);
  updateBall(m, dt);

  if (m.ball.state === 'held' && m.shotClock <= 0) {
    const c = holder(m);
    c.line.to += 1;
    emit(m, { type: 'turnover', text: `Shot clock violation on ${c.team === m.human.team ? 'your team' : 'them'}` });
    changePossession(m, other(c.team), c.pos);
  }

  if (m.clock <= 0) endPeriod(m);
}

function endPeriod(m) {
  m.clock = 0;
  const lastRegulation = m.quarter >= m.quarters;
  if (lastRegulation && m.score.home !== m.score.away) {
    m.phase = 'final';
    const won = m.score.home > m.score.away;
    emit(m, { type: 'final', won, text: `Final: ${m.score.home} to ${m.score.away}` });
    return;
  }
  m.quarter += 1;
  m.clock = m.quarter > m.quarters ? OVERTIME_SECONDS : m.quarterLength;
  m.phase = 'break';
  m.breakLeft = BREAK_SECONDS;
  m.ball.state = 'dead';
  emit(m, { type: 'period', quarter: m.quarter, text: m.quarter > m.quarters ? 'Overtime' : `End of the ${ordinal(m.quarter - 1)} quarter` });
}

const ordinal = (n) => ['first', 'second', 'third', 'fourth'][n - 1] || `${n}th`;

function speedOf(m, p) {
  let s = p.baseSpeed;
  let bonus = 0;
  if (p.buffs.burstUntil > m.time) bonus += p.buffs.burstBonus;
  const tb = m.teamBuffs[p.team];
  if (tb.fastUntil > m.time) bonus += tb.fastBonus;
  s *= 1 + bonus;
  if (m.ball.holder === p.id) s *= 0.9;
  if (p.stamina < 10) s *= 0.85;
  return s;
}

function move(m, p, dt) {
  if (p.dash) {
    p.pos.x += p.dash.vx * dt;
    p.pos.y += p.dash.vy * dt;
    p.dash.t -= dt;
    clampPos(p);
    if (p.dash.t <= 0) endDash(m, p);
    return;
  }
  if (!p.target) return;
  const dx = p.target.x - p.pos.x;
  const dy = p.target.y - p.pos.y;
  const d = Math.hypot(dx, dy);
  const stepLen = speedOf(m, p) * dt;
  if (d <= stepLen) {
    p.pos = { ...p.target };
    if (p.isHuman) p.target = null;
  } else {
    p.pos.x += (dx / d) * stepLen;
    p.pos.y += (dy / d) * stepLen;
  }
  clampPos(p);
}

function clampPos(p) {
  p.pos.x = clamp(p.pos.x, 12, COURT_W - 12);
  p.pos.y = clamp(p.pos.y, 12, COURT_H - 12);
}

function separate(m) {
  const list = m.all;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i].pos;
      const b = list[j].pos;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < SEPARATION) {
        const push = (SEPARATION - d) / 2;
        a.x -= (dx / d) * push; a.y -= (dy / d) * push;
        b.x += (dx / d) * push; b.y += (dy / d) * push;
      }
    }
  }
  for (const p of list) clampPos(p);
}

function updateBall(m, dt) {
  const b = m.ball;
  if (b.state === 'held') {
    const h = holder(m);
    b.pos = { ...h.pos };
    b.z = 0;
    return;
  }
  if (b.state === 'pass') {
    const to = m.byId.get(b.pass.toId);
    const dx = to.pos.x - b.pos.x;
    const dy = to.pos.y - b.pos.y;
    const d = Math.hypot(dx, dy);
    const stepLen = PASS_SPEED * dt;
    if (d <= Math.max(stepLen, 10)) {
      m.lastPass = { fromId: b.pass.fromId, toId: to.id, at: m.time };
      giveBall(m, to);
      return;
    }
    b.pos.x += (dx / d) * stepLen;
    b.pos.y += (dy / d) * stepLen;
    for (const def of m.teams[other(to.team)]) {
      if (b.pass.tried.has(def.id) || dist(def.pos, b.pos) > INTERCEPT_RADIUS) continue;
      b.pass.tried.add(def.id);
      if (m.rng() < 0.25 + 0.3 * grade(stat(def, 'defense'))) {
        const from = m.byId.get(b.pass.fromId);
        from.line.to += 1;
        def.line.stl += 1;
        giveBall(m, def);
        emit(m, { type: 'steal', playerId: def.id, team: def.team, at: { ...def.pos }, text: `${def.name} picks off the pass` });
        return;
      }
    }
    return;
  }
  if (b.state === 'shot') {
    const s = b.shot;
    s.t += dt;
    const k = Math.min(s.t / s.dur, 1);
    b.pos = { x: lerp(s.from.x, s.rim.x, k), y: lerp(s.from.y, s.rim.y, k) };
    b.z = Math.sin(Math.PI * k) * 42;
    if (k < 1) return;
    const shooter = m.byId.get(s.shooterId);
    if (s.made) {
      m.score[s.team] += s.points;
      shooter.line.pts += s.points;
      shooter.line.fgm += 1;
      const lp = m.lastPass;
      if (lp && lp.toId === shooter.id && m.time - lp.at < 4) m.byId.get(lp.fromId).line.ast += 1;
      emit(m, {
        type: 'make', points: s.points, team: s.team, hoop: { ...s.rim }, at: { ...s.from }, playerId: shooter.id,
        text: `${shooter.name} ${s.points === 3 ? 'hits a three' : 'scores'}`,
      });
      changePossession(m, other(s.team), s.rim);
    } else {
      const ang = (s.team === 'home' ? Math.PI : 0) + (m.rng() - 0.5) * 2.2;
      const r = 30 + m.rng() * 45;
      b.state = 'loose';
      b.pos = { x: clamp(s.rim.x + Math.cos(ang) * r, 12, COURT_W - 12), y: clamp(s.rim.y + Math.sin(ang) * r, 12, COURT_H - 12) };
      b.z = 14;
      b.looseFor = 0;
      b.shooterTeam = s.team;
      emit(m, { type: 'miss', team: s.team, hoop: { ...s.rim }, playerId: shooter.id, text: `${shooter.name} misses` });
    }
    return;
  }
  if (b.state === 'loose') {
    b.looseFor += dt;
    b.z = Math.max(0, b.z - 40 * dt);
    if (b.z > 6) return;
    const grab = nearestTo(m.all, b.pos, PICKUP_RADIUS);
    const p = grab || (b.looseFor > 3 ? nearestTo(m.all, b.pos, Infinity) : null);
    if (!p) return;
    p.line.reb += 1;
    const offensive = p.team === b.shooterTeam;
    m.offense = p.team;
    giveBall(m, p, false);
    emit(m, { type: 'rebound', playerId: p.id, team: p.team, text: `${p.name} ${offensive ? 'grabs the offensive board' : 'rebounds'}` });
  }
}

// ---------------------------------------------------------------------------
// AI

function nearestDefenderDist(m, p) {
  let best = Infinity;
  for (const d of m.teams[other(p.team)]) best = Math.min(best, dist(d.pos, p.pos));
  return best;
}

function laneClear(m, from, to) {
  for (const d of m.teams[other(from.team)]) if (segDist(d.pos, from.pos, to.pos) < 18) return false;
  return true;
}

const inFrontCourt = (p) => (p.team === 'home' ? p.pos.x > MID_X : p.pos.x < MID_X);

function think(m, p, dt) {
  p.think -= dt;
  const b = m.ball;

  // Chase a loose ball: the two nearest players on each side go get it.
  if (b.state === 'loose') {
    const mates = m.teams[p.team].filter((q) => !q.isHuman).sort((a, c) => dist(a.pos, b.pos) - dist(c.pos, b.pos));
    if (mates.indexOf(p) < 2) { p.target = { ...b.pos }; return; }
  }

  const onOffense = m.offense === p.team;
  if (holder(m) === p) return thinkCarrier(m, p);

  if (onOffense) {
    const s = spotFor(p.team, p.idx);
    if (p.cutUntil > m.time) p.target = { x: lerp(s.x, RIM[p.team].x, 0.7), y: lerp(s.y, RIM[p.team].y, 0.7) };
    else p.target = s;
    if (p.think <= 0) {
      p.think = 0.6 + m.rng() * 0.6;
      if (b.state === 'held' && m.rng() < 0.08) p.cutUntil = m.time + 1.4;
    }
    return;
  }

  // Defense: man-to-man. Stand between your man and the rim you protect.
  const man = m.teams[other(p.team)][p.idx];
  const rim = RIM[man.team];
  const gap = holder(m) === man ? 0.12 : 0.28;
  p.target = { x: lerp(man.pos.x, rim.x, gap), y: lerp(man.pos.y, rim.y, gap) };

  if (p.think > 0) return;
  p.think = 0.3 + m.rng() * 0.3;
  const carrier = holder(m);
  if (carrier === man) {
    const d = dist(p.pos, carrier.pos);
    if (d <= STEAL_RANGE && m.rng() < 0.35) trySteal(m, p, carrier);
    else if (d > 50 && d < p.kit.E.distance && dist(carrier.pos, rim) < 230 && m.rng() < 0.3) cast(m, p, 'E', carrier.pos);
    if (p.kit.R.id === 'wall' && dist(carrier.pos, rim) < 150 && m.rng() < 0.25) cast(m, p, 'R');
  }
}

function thinkCarrier(m, p) {
  const rim = RIM[p.team];
  const toRim = dist(p.pos, rim);

  if (p.think > 0) {
    if (!p.target) p.target = { ...rim };
    return;
  }
  p.think = 0.3 + m.rng() * 0.15;

  if (!inFrontCourt(p)) {
    p.target = spotFor(p.team, 0);
    if (p.kit.R.id === 'fastbreak' && m.rng() < 0.2) cast(m, p, 'R');
    return;
  }

  // The shot a carrier will settle for gets worse as the shot clock runs.
  const urgency = clamp((SHOT_CLOCK - m.shotClock) / SHOT_CLOCK, 0, 1);
  const ev = (q) => shotChance(m, q) * shotPoints(q, q.pos);
  const mine = ev(p);
  if (m.shotClock < 3 || toRim < 60 || mine >= lerp(1.0, 0.7, urgency)) {
    if (p.kit.R.id === 'limitless' && toRim > THREE_DIST && m.rng() < 0.5) cast(m, p, 'R');
    return shoot(m, p);
  }

  let best = null;
  for (const q of m.teams[p.team]) {
    if (q === p) continue;
    let v = ev(q);
    if (q.isHuman) {
      v += 0.15;
      if (p.callFor > m.time || q.callFor > m.time) v += 0.5;
    }
    if (!best || v > best.v) best = { q, v };
  }
  if (best && best.v > mine + lerp(0.12, 0.02, urgency) && laneClear(m, p, best.q)) return pass(m, p, best.q);

  // Drive: attack the rim, leaning away from the nearest defender.
  const near = nearestDefenderDist(m, p);
  const side = p.pos.y < rim.y ? -1 : 1;
  p.target = { x: rim.x + (p.team === 'home' ? -30 : 30), y: rim.y + side * (near < 40 ? 40 : 10) };
  if (near < 45 && m.rng() < 0.25) cast(m, p, 'W');
  if (near < 35 && toRim > 120 && m.rng() < 0.2) cast(m, p, 'Q', nearestDefender(m, p).pos);
}

function nearestDefender(m, p) {
  let best = null;
  for (const d of m.teams[other(p.team)]) if (!best || dist(d.pos, p.pos) < dist(best.pos, p.pos)) best = d;
  return best;
}

// ---------------------------------------------------------------------------
// View

function view(m) {
  const h = m.human;
  const carrier = holder(m);
  const toRender = (p) => ({ id: p.id, name: p.name, x: p.pos.x - 15, y: p.pos.y - 15 });
  const man = m.teams[other(h.team)][h.idx];
  return {
    players: m.teams.home.map(toRender),
    bots: m.teams.away.map(toRender),
    ball: {
      x: m.ball.pos.x - 6,
      y: m.ball.pos.y - 6,
      z: m.ball.z,
      possessorId: carrier ? carrier.id : -1,
      isPossessed: !!carrier,
    },
    homeScore: m.score.home,
    awayScore: m.score.away,
    hud: {
      phase: m.phase,
      quarter: m.quarter,
      quarters: m.quarters,
      clock: Math.max(0, m.clock),
      shotClock: Math.max(0, m.shotClock),
      offense: m.offense,
      human: {
        id: h.id,
        name: h.name,
        stamina: h.stamina,
        hasBall: carrier === h,
        onDefense: m.offense !== h.team,
        cooldowns: { ...h.cd },
        kit: h.kit,
        buffs: {
          burst: Math.max(0, h.buffs.burstUntil - m.time),
          limitless: Math.max(0, h.buffs.limitlessUntil - m.time),
          stepback: Math.max(0, h.buffs.stepbackUntil - m.time),
        },
        shotChance: carrier === h ? shotChance(m, h) : null,
        shotPoints: carrier === h ? shotPoints(h, h.pos) : null,
      },
    },
    overlay: {
      human: { ...h.pos },
      marker: h.target ? { ...h.target } : null,
      man: m.offense !== h.team ? { ...man.pos } : null,
      zones: m.zones.map((z) => ({ ...z.center(), r: z.radius, team: z.team })),
      locks: m.all.filter((p) => p.lock).map((p) => ({ ...p.pos })),
    },
  };
}

/** Box-score lines for both teams, for the end screen. */
export function boxScore(match) {
  const m = match._m;
  const row = (p) => ({ id: p.id, name: p.name, isHuman: p.isHuman, ...p.line });
  return { home: m.teams.home.map(row), away: m.teams.away.map(row), score: { ...m.score } };
}
