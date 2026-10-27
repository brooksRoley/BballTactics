/**
 * match.js — Full Court rules: a seeded 5v5 full-court game where one player
 * is human-controlled (right-click move, Q/W/E/R, Space to shoot, left-click
 * to pass or reach) and the other nine are AI.
 *
 * Pure and deterministic for a given seed and command log: no DOM, no Vue,
 * runs under plain `node`. The rules advance in fixed ticks of 1/60 s. A
 * command is stamped with the tick it lands on and applied at the start of
 * that tick, never between ticks, so a match is fully described by
 * { rulesVersion, seed, humanId, options, log } and replay() reproduces it at
 * any frame rate. stateHash() fingerprints the state for checkpoints, golden
 * replays and (later) lockstep desync checks. See docs/design/game-modes.md.
 *
 * Known gap: Math.sin/cos/hypot are not guaranteed bit-identical across JS
 * engines, so a log recorded in one browser may drift in another. Replays are
 * exact within one engine. Porting the rules to shared-core (WebAssembly)
 * closes this. The view() it returns uses the same
 * { players, bots, ball } shape as GameManager.GetGameStateJSON(), so
 * CourtRenderer draws it unchanged; the extra `hud` and `overlay` fields are
 * what only this mode needs. See docs/design/full-court.md.
 */

import { buildKit, moveSpeed, stat, SLOTS } from './kits.js';
import { animFor } from './anim.js';

export const COURT_W = 800;
export const COURT_H = 400;
const MID_X = COURT_W / 2;

// Rims match CourtRenderer's drawn hoops. Home attacks right, away attacks left.
const RIM = { home: { x: COURT_W - 20, y: COURT_H / 2 }, away: { x: 20, y: COURT_H / 2 } };
const THREE_DIST = 160;
export const TICK = 1 / 60;
/**
 * Bump this whenever a rules change would make an old log play differently
 * (anything that moves a player, rolls the RNG, or changes a number). Replays
 * refuse a log from another version, and the golden replays in
 * client/moba/__tests__/goldens/ must be regenerated (see its README).
 */
export const RULES_VERSION = 1;
/** A state hash is recorded every this many ticks (once a second). */
export const CHECKPOINT_TICKS = 60;
const HASH_SCALE = 1000; // positions and clocks are hashed to 1/1000
const MAX_TICKS = 60 * 60 * 30; // a replay that runs past 30 minutes is broken

export const SHOT_CLOCK = 14;
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
export const CLUTCH_SECONDS = 10;    // last seconds of a period: the HUD flags them
export const RALLY_DEFICIT = 4;     // a team down this many gets the rally bonus
export const RALLY_BONUS = 0.15;    // shot chance x(1 + this) while rallying
const STUMBLE_SECONDS = 0.45; // a step-back leaves the nearest defender flat-footed
const TUTORIAL_SHOT_CLOCK = 24;

// Offensive spots for a team attacking the right rim; away mirrors x.
const SPOTS = [
  { x: 590, y: 200 }, // top
  { x: 650, y: 95 },  // left wing
  { x: 650, y: 305 }, // right wing
  { x: 755, y: 45 },  // left corner
  { x: 755, y: 355 }, // right corner
];

/**
 * mulberry32, the same sequence as fallbackSim.js's, with its state readable
 * so stateHash() can include it.
 */
function seededRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.state = () => a | 0;
  return next;
}

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
  const rng = seededRng(seed ^ 0x5eed);
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

/** True when `team` trails by at least RALLY_DEFICIT: the gentle comeback rule. */
export const rallying = (m, team) => m.score[other(team)] - m.score[team] >= RALLY_DEFICIT;

/**
 * Why a shot from `at` has the chance it has: every factor that moved it, so
 * the HUD can show the number and a miss can name its cause. Exported for
 * tests; shotChance() is its `chance`.
 */
export function shotBreakdown(m, shooter, at = shooter.pos) {
  const rim = RIM[shooter.team];
  const d = dist(at, rim);
  const sh = grade(stat(shooter, 'shooting'));
  const limitless = shooter.buffs.limitlessUntil > m.time;

  let zone;
  let p = lerp(0.46, 0.66, sh);
  if (d < 60) { zone = 'rim'; p += 0.12; }
  else if (d <= THREE_DIST) { zone = 'mid'; p *= 0.86; }
  else if (limitless) { zone = 'three'; p *= 0.82; }
  else if (d > 240 && !(shooter.buffs.stepbackUntil > m.time)) { zone = 'deep'; p *= 0.42; }
  else { zone = 'three'; p *= 0.66; }
  const base = p;

  let contest = 0;
  let contestBy = null;
  for (const def of m.teams[other(shooter.team)]) {
    const cd = dist(def.pos, at);
    if (cd >= 50) continue;
    const c = ((50 - cd) / 50) * lerp(0.18, 0.42, grade(stat(def, 'defense')));
    if (c > contest) { contest = c; contestBy = def; }
  }
  const locked = !!(shooter.lock && shooter.lock.until > m.time);
  if (locked) {
    contest += shooter.lock.contestBonus;
    if (!contestBy) contestBy = m.byId.get(shooter.lock.by) || null;
  }
  const stepback = shooter.buffs.stepbackUntil > m.time;
  if (stepback) contest *= 1 - shooter.buffs.stepbackIgnore;
  contest = clamp(contest, 0, 0.85);
  p *= 1 - contest;

  let wall = null;
  for (const z of m.zones) {
    if (z.team !== shooter.team && z.until > m.time && dist(z.center(), at) <= z.radius) {
      p *= 1 - z.penalty;
      wall = m.byId.get(z.ownerId) || null;
    }
  }
  const rally = rallying(m, shooter.team);
  if (rally) p *= 1 + RALLY_BONUS;

  const chance = clamp(p, 0.03, 0.9);
  const label = contest >= 0.3 || wall ? 'smothered' : contest >= 0.1 ? 'contested' : 'open';
  return {
    chance,
    base,
    points: d > THREE_DIST ? 3 : 2,
    zone,
    contest,
    contestBy: contestBy ? contestBy.name : null,
    locked,
    stepback,
    wall: wall ? wall.name : null,
    limitless,
    rally,
    label,
  };
}

/** Chance a shot from `at` goes in, before the roll. Exported for tests. */
export function shotChance(m, shooter, at = shooter.pos) {
  return shotBreakdown(m, shooter, at).chance;
}

/**
 * One short reason for how a shot went, from its breakdown: the biggest thing
 * that hurt it on a miss, the thing that helped on a make.
 */
export function shotReason(b, made) {
  const pct = `${Math.round(b.chance * 100)}%`;
  if (made) {
    if (b.stepback && b.contest < 0.1) return `${pct}: the step-back made the space`;
    if (b.rally) return `${pct}, with the rally bonus`;
    if (b.label === 'open') return `${pct}: open look`;
    return `${pct}: tough shot over ${b.contestBy}`;
  }
  if (b.wall) return `${pct}: inside ${b.wall}'s Wall`;
  if (b.locked) return `${pct}: ${b.contestBy} closed out`;
  if (b.contest >= 0.1 && b.contestBy) return `${pct}: contested by ${b.contestBy}`;
  if (b.zone === 'deep') return `${pct}: a deep heave`;
  if (b.zone === 'three') return `${pct}: an open three that rimmed out`;
  return `${pct}: open, just missed`;
}

const shotPoints = (shooter, at) => (dist(at, RIM[shooter.team]) > THREE_DIST ? 3 : 2);

/**
 * Create a match. `roster` is the engine_roster.json array, `humanId` the
 * player the human picked. Options: seed, quarterLength (s), quarters, and
 * tutorial: the opening ball goes to a teammate who waits for the human to
 * call for it, with a long shot clock, so the first possession can teach.
 */
export function createMatch({ roster, humanId, seed = 1, quarterLength = 45, quarters = 4, tutorial = false }) {
  const rng = seededRng(seed);
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
    stumbleUntil: 0,
    denyUntil: 0,
    lock: null,
    stealCd: 0,
    think: rng() * 0.4,
    cutUntil: 0,
    line: { pts: 0, fga: 0, fgm: 0, ast: 0, stl: 0, reb: 0, to: 0 },
  });

  const m = {
    rng,
    spec: { seed, humanId, options: { quarterLength, quarters, tutorial: !!tutorial } },
    tick: 0,                 // ticks run so far; the next tick to run is m.tick
    queue: [],               // { tick, playerId, command } waiting for their tick
    log: [],                 // every command accepted, in order
    checkpoints: [],         // stateHash() every CHECKPOINT_TICKS ticks
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
    // The current possession: who has it, whether the human has touched the
    // ball in it, and when it began. Drives the HUD and the sweep metrics.
    poss: { n: 0, team: 'home', start: 0, touched: false },
    tutorial: tutorial ? { hold: true } : null,
    clutchCalled: false,
    buzzer: false,
  };
  m.all = [...m.teams.home, ...m.teams.away];
  m.human = m.all.find((p) => p.isHuman);
  m.byId = new Map(m.all.map((p) => [p.id, p]));

  startPeriod(m, 'home');

  return {
    /**
     * Queue a command for the next tick. It is logged with that tick and
     * applied at the start of it. Returns the log entry, or null when the
     * command was dropped (malformed, or the game is not live).
     */
    command: (cmd, playerId = m.human.id) => enqueue(m, cmd, playerId),
    step: (dt) => step(m, dt),
    /**
     * Schedule a recorded log on this match: each entry is applied at the
     * start of its tick, however the frames fall. replay() uses it; so does
     * the frame-rate test, which drives step() at 30, 60 and 144 fps.
     */
    loadLog: (log) => loadLog(m, log),
    /** Run exactly `n` ticks, independent of frame time (replays, tests). */
    runTicks: (n) => runTicks(m, n),
    view: () => view(m),
    drainEvents: () => m.events.splice(0, m.events.length),
    /** Everything replay() needs to reproduce this match so far. */
    record: () => record(m),
    hash: () => stateHash(m),
    /** Internal state, for tests and the debug overlay. */
    _m: m,
  };
}

// ---------------------------------------------------------------------------
// Command log, hashes and replay

const COMMAND_TYPES = new Set(['move', 'stop', 'shoot', 'click', 'cast']);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * A clean, plain copy of a command, or null if it can't be applied. Only the
 * fields the rules read are kept, so a log is small and a hostile or broken
 * client (or a future network peer) can't smuggle NaN into the state.
 */
export function sanitizeCommand(cmd) {
  if (!cmd || typeof cmd !== 'object' || !COMMAND_TYPES.has(cmd.type)) return null;
  const out = { type: cmd.type };
  if (cmd.type === 'move' || cmd.type === 'click') {
    if (!isNum(cmd.x) || !isNum(cmd.y)) return null;
    out.x = cmd.x; out.y = cmd.y;
  } else if (cmd.type === 'cast') {
    if (!SLOTS.includes(cmd.slot)) return null;
    out.slot = cmd.slot;
    // Aim is optional: without a finite point the ability uses its default.
    if (isNum(cmd.x) && isNum(cmd.y)) { out.x = cmd.x; out.y = cmd.y; }
  }
  return out;
}

function enqueue(m, cmd, playerId) {
  if (m.phase !== 'live' || playerId !== m.human.id) return null;
  const clean = sanitizeCommand(cmd);
  if (!clean) return null;
  const entry = { tick: m.tick, playerId, command: clean };
  m.queue.push(entry);
  m.log.push(entry);
  return entry;
}

function applyQueued(m) {
  if (!m.queue.length) return;
  let i = 0;
  while (i < m.queue.length && m.queue[i].tick <= m.tick) i += 1;
  if (!i) return;
  for (const e of m.queue.splice(0, i)) command(m, e.command);
}

function loadLog(m, log = []) {
  const entries = log
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e && Number.isInteger(e.tick) && e.tick >= m.tick && e.playerId === m.human.id)
    .sort((a, b) => a.e.tick - b.e.tick || a.i - b.i);
  for (const { e } of entries) {
    const clean = sanitizeCommand(e.command);
    if (!clean) continue;
    const entry = { tick: e.tick, playerId: e.playerId, command: clean };
    m.queue.push(entry);
    m.log.push(entry);
  }
  m.queue.sort((a, b) => a.tick - b.tick);
}

function runTicks(m, n) {
  for (let i = 0; i < n && m.phase !== 'final'; i++) tick(m, TICK);
}

function record(m) {
  return {
    rulesVersion: RULES_VERSION,
    seed: m.spec.seed,
    humanId: m.spec.humanId,
    options: { ...m.spec.options },
    log: m.log.map((e) => ({ tick: e.tick, playerId: e.playerId, command: { ...e.command } })),
    ticks: m.tick,
    hash: stateHash(m),
  };
}

const PHASE_CODE = { live: 1, break: 2, final: 3 };
const BALL_CODE = { held: 1, pass: 2, shot: 3, loose: 4, dead: 5 };

/**
 * A cheap, stable fingerprint of the state: FNV-1a over the tick, phase,
 * clocks, score, RNG state, the ball and every player's position and
 * stamina, with reals rounded to 1/1000. Two matches with the same hash at
 * the same tick are, for every practical purpose, the same match. Accepts a
 * match or its internal state; returns 8 hex digits.
 */
export function stateHash(match) {
  const m = match && match._m ? match._m : match;
  let h = 0x811c9dc5;
  const mix = (v) => {
    let x = v | 0;
    for (let k = 0; k < 4; k++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193);
      x >>>= 8;
    }
  };
  const real = (v) => mix(Math.round(v * HASH_SCALE));
  mix(m.tick);
  mix(PHASE_CODE[m.phase] || 0);
  mix(m.quarter);
  real(m.clock);
  real(m.shotClock);
  real(m.breakLeft);
  mix(m.offense === 'home' ? 1 : 2);
  mix(m.score.home);
  mix(m.score.away);
  mix(m.rng && typeof m.rng.state === 'function' ? m.rng.state() : -1);
  const b = m.ball;
  mix(BALL_CODE[b.state] || 0);
  mix(b.state === 'held' ? b.holder : -1);
  real(b.pos.x);
  real(b.pos.y);
  real(b.z);
  for (const p of m.all) {
    mix(p.id);
    real(p.pos.x);
    real(p.pos.y);
    real(p.stamina);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Re-run a recorded match. Same rules version, seed, roster and log give the
 * same match, tick for tick: returns it with its final hash and the hash at
 * every checkpoint. Runs to `ticks` when given (a recording of a game still
 * in progress), otherwise to the final buzzer.
 */
export function replay({ roster, humanId, seed, options = {}, log = [], rulesVersion, ticks } = {}) {
  if (rulesVersion !== RULES_VERSION) {
    throw new Error(`Replay recorded with rules version ${rulesVersion}; these rules are version ${RULES_VERSION}`);
  }
  const match = createMatch({ roster, humanId, seed, ...options });
  const m = match._m;
  loadLog(m, log);
  const limit = Number.isInteger(ticks) ? ticks : MAX_TICKS;
  while (m.tick < limit && m.phase !== 'final') tick(m, TICK);
  return { match, hash: stateHash(m), ticks: m.tick, checkpoints: [...m.checkpoints] };
}

// ---------------------------------------------------------------------------
// Periods and possession

function spotFor(team, idx) {
  const s = SPOTS[idx % SPOTS.length];
  return team === 'home' ? { x: s.x, y: s.y } : { x: COURT_W - s.x, y: s.y };
}

function newPossession(m, team) {
  if (m.tutorial && m.poss.n > 0) m.tutorial.hold = false;
  m.poss = { n: m.poss.n + 1, team, start: m.time, touched: false };
}

function startPeriod(m, offense) {
  m.offense = offense;
  m.shotClock = SHOT_CLOCK;
  m.zones = [];
  m.lastPass = null;
  m.clutchCalled = false;
  m.buzzer = false;
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
  // The tutorial opener hands the ball to a teammate, so "get the ball" is a
  // real step; otherwise the team's first player (the human, at home) brings
  // it up.
  const teach = m.tutorial && m.tutorial.hold && offense === m.human.team;
  const carrier = teach ? m.teams[offense][1] : m.teams[offense][0];
  carrier.pos = { x: MID_X - dir * 90, y: COURT_H / 2 };
  newPossession(m, offense);
  giveBall(m, carrier, false);
  if (teach) {
    m.shotClock = TUTORIAL_SHOT_CLOCK;
    m.human.pos = { x: MID_X - dir * 150, y: SPOTS[1].y };
  }
}

function giveBall(m, p, countsAsChange = true) {
  const changed = countsAsChange && p.team !== m.offense;
  if (p.team !== m.poss.team) newPossession(m, p.team);
  if (p.isHuman) {
    m.poss.touched = true;
    if (m.tutorial) m.tutorial.hold = false;
  }
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
          target.callAnswered = false;
          emit(m, { type: 'call', text: `You call for it from ${target.name}` });
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

  const aimPt = aim && isNum(aim.x) && isNum(aim.y) ? aim : RIM[other(p.team)];
  switch (a.id) {
    case 'stepback': {
      const before = shotChance(m, p);
      const near = nearestDefender(m, p);
      if (near && dist(near.pos, p.pos) < 70) near.stumbleUntil = m.time + 0.18 + STUMBLE_SECONDS;
      let dx = p.pos.x - aimPt.x;
      let dy = p.pos.y - aimPt.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      p.dash = { vx: (dx * a.distance) / 0.18, vy: (dy * a.distance) / 0.18, t: 0.18, stepback: { before, beat: near && near.stumbleUntil > m.time ? near.name : null } };
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
  const sb = p.dash && p.dash.stepback;
  p.dash = null;
  if (sb && holder(m) === p) {
    // The step-back's payoff, as numbers: the shot before and after it.
    const after = shotChance(m, p);
    const pct = (v) => `${Math.round(v * 100)}%`;
    emit(m, {
      type: 'stepback', playerId: p.id, team: p.team, before: sb.before, after, at: { ...p.pos },
      text: `${p.name} steps back${sb.beat ? `, ${sb.beat} stumbles` : ''}: ${pct(sb.before)} to ${pct(after)}`,
    });
  }
  if (!co) return;
  const carrier = holder(m);
  if (carrier && carrier.team !== p.team && dist(carrier.pos, p.pos) <= co.lockRadius) {
    const before = shotChance(m, carrier);
    carrier.lock = { until: m.time + co.lockDuration, contestBonus: co.contestBonus, stealBonus: co.stealBonus, by: p.id };
    const after = shotChance(m, carrier);
    emit(m, {
      type: 'lock', playerId: carrier.id, byId: p.id, team: p.team, before, after, at: { ...carrier.pos },
      text: `${p.name} closes out on ${carrier.name}: ${Math.round(before * 100)}% to ${Math.round(after * 100)}%`,
    });
    return;
  }
  // Landing on a man without the ball denies him: nobody passes to him, and a
  // pass already in the air is twice as easy to pick off.
  const target = nearestTo(m.teams[other(p.team)].filter((q) => q !== carrier), p.pos, co.lockRadius);
  if (target) {
    target.denyUntil = m.time + co.lockDuration;
    emit(m, { type: 'deny', playerId: target.id, byId: p.id, team: p.team, at: { ...target.pos }, text: `${p.name} denies ${target.name}: no passes to him` });
  } else if (p.isHuman) {
    emit(m, { type: 'whiff', playerId: p.id, team: p.team, at: { ...p.pos }, text: 'Closeout landed short of the ball' });
  }
}

// ---------------------------------------------------------------------------
// Ball actions

function shoot(m, p) {
  const at = { ...p.pos };
  const breakdown = shotBreakdown(m, p, at);
  const { chance, points } = breakdown;
  const made = m.rng() < chance;
  const rim = RIM[p.team];
  const d = dist(at, rim);
  p.line.fga += 1;
  m.ball.state = 'shot';
  m.ball.holder = null;
  m.ball.shot = { from: at, rim, t: 0, dur: 0.5 + d / 1400, made, points, shooterId: p.id, team: p.team, chance, breakdown, clutch: m.clock <= CLUTCH_SECONDS };
  p.target = null;
  emit(m, { type: 'shot', playerId: p.id, team: p.team, chance, points, breakdown, at });
}

function pass(m, from, to) {
  if (to.team !== from.team || to === from) return;
  m.ball.state = 'pass';
  m.ball.holder = null;
  m.ball.pos = { ...from.pos };
  m.ball.z = 10;
  m.ball.pass = { fromId: from.id, toId: to.id, tried: new Set() };
}

/**
 * Chance a reach-in strips `carrier`. A closeout lock and the thief's Burst
 * help; the carrier's Burst protects the ball. Exported for tests and the HUD.
 */
export function stealChance(m, thief, carrier) {
  let p = 0.12 + 0.15 * grade(stat(thief, 'defense')) - 0.08 * grade(stat(carrier, 'speed'));
  if (carrier.lock && carrier.lock.until > m.time) p += carrier.lock.stealBonus;
  if (thief.buffs.burstUntil > m.time) p += 0.06;
  if (!thief.isHuman) p *= 0.6;
  if (carrier.buffs.burstUntil > m.time) p *= 0.7;
  return clamp(p, 0.03, 0.5);
}

function trySteal(m, thief, carrier) {
  if (thief.stealCd > 0) return;
  thief.stealCd = thief.isHuman ? HUMAN_STEAL_CD : 1.2;
  if (dist(thief.pos, carrier.pos) > STEAL_RANGE) {
    if (thief.isHuman) deny(m, `Too far to reach ${carrier.name}: get closer`);
    return;
  }
  const p = stealChance(m, thief, carrier);
  const pct = `${Math.round(p * 100)}%`;
  if (m.rng() < p) {
    thief.line.stl += 1;
    carrier.line.to += 1;
    const locked = carrier.lock && carrier.lock.until > m.time;
    const reason = locked ? `${pct}, after the closeout` : carrier.isHuman ? `${pct}: you let ${thief.name} get within reach` : `${pct} reach`;
    giveBall(m, thief);
    emit(m, { type: 'steal', kind: 'reach', playerId: thief.id, victimId: carrier.id, team: thief.team, at: { ...thief.pos }, reason, text: `${thief.name} strips ${carrier.name} (${reason})` });
  } else if (thief.isHuman) {
    emit(m, { type: 'reach', playerId: thief.id, team: thief.team, at: { ...carrier.pos }, text: `Reached in on ${carrier.name}, came up empty (${pct})` });
  }
}

// ---------------------------------------------------------------------------
// The loop

function step(m, dt) {
  if (!(dt > 0)) return; // NaN, negative or zero frame time: nothing to run
  m.acc += Math.min(dt, 0.25);
  while (m.acc >= TICK) {
    m.acc -= TICK;
    tick(m, TICK);
  }
}

/**
 * One fixed tick: apply the commands stamped for it, then the rules. The
 * game stops ticking at the final buzzer, so the final state (and its hash)
 * does not depend on how many frames are drawn after it.
 */
function tick(m, dt) {
  if (m.phase === 'final') return;
  applyQueued(m);
  advance(m, dt);
  m.tick += 1;
  if (m.tick % CHECKPOINT_TICKS === 0) m.checkpoints.push(stateHash(m));
}

function advance(m, dt) {
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

  // A shot in the air when the period clock hits zero still counts: the
  // period ends once it lands (a buzzer-beater), not mid-flight.
  m.clock -= dt;
  if (m.clock <= 0) {
    if (m.ball.state !== 'shot') {
      // The horn sounds the tick the clock runs out: nothing after it in
      // this tick (an AI's last-second heave, a pass) may happen. Before,
      // the rest of the tick ran first, so a shot released after zero could
      // count as a buzzer-beater (found by fuzz.test.js).
      endPeriod(m);
      return;
    }
    m.clock = 0;
    m.buzzer = true;
  }
  if (m.ball.state === 'held') m.shotClock -= dt;
  if (!m.clutchCalled && m.clock <= CLUTCH_SECONDS && m.clock > 0) {
    m.clutchCalled = true;
    const last = m.quarter >= m.quarters;
    const diff = m.score[m.human.team] - m.score[other(m.human.team)];
    const state = diff === 0 ? 'tied' : diff > 0 ? `up ${diff}` : `down ${-diff}`;
    emit(m, { type: 'clutch', text: last ? `Final ${CLUTCH_SECONDS} seconds, ${state}` : `${CLUTCH_SECONDS} seconds left in the quarter` });
  }

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

  if (m.ball.state === 'held' && m.shotClock <= 0 && m.clock > 0) {
    const c = holder(m);
    c.line.to += 1;
    emit(m, {
      type: 'turnover', playerId: c.id, team: c.team, at: { ...c.pos },
      reason: c.isHuman ? 'you held it too long' : `${c.name} held it too long`,
      text: `Shot clock violation on ${c.isHuman ? 'you' : c.team === m.human.team ? 'your team' : 'them'}: ${c.isHuman ? 'you' : c.name} held it too long`,
    });
    changePossession(m, other(c.team), c.pos);
  }

  if (m.clock <= 0 && m.ball.state !== 'shot') endPeriod(m);
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
  m.ball.holder = null; // nobody holds a dead ball (the fuzz invariant)
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
  if (!p.dash && p.stumbleUntil > m.time) return;
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
      const denied = to.denyUntil > m.time ? 2 : 1;
      if (m.rng() < (0.25 + 0.3 * grade(stat(def, 'defense'))) * denied) {
        const from = m.byId.get(b.pass.fromId);
        from.line.to += 1;
        def.line.stl += 1;
        giveBall(m, def);
        const reason = denied > 1 ? `${to.name} was denied` : 'passing lane read';
        emit(m, { type: 'steal', kind: 'interception', playerId: def.id, victimId: from.id, team: def.team, at: { ...def.pos }, reason, text: `${def.name} picks off ${from.name}'s pass: ${reason}` });
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
    const reason = shotReason(s.breakdown, s.made);
    const buzzer = m.buzzer;
    if (s.made) {
      m.score[s.team] += s.points;
      shooter.line.pts += s.points;
      shooter.line.fgm += 1;
      m.lastMake = { id: shooter.id, at: m.time }; // presentation only (anim.js)
      const lp = m.lastPass;
      if (lp && lp.toId === shooter.id && m.time - lp.at < 4) m.byId.get(lp.fromId).line.ast += 1;
      emit(m, {
        type: 'make', points: s.points, team: s.team, hoop: { ...s.rim }, at: { ...s.from }, playerId: shooter.id,
        chance: s.chance, reason, clutch: s.clutch, buzzer,
        text: `${shooter.name} ${s.points === 3 ? 'hits a three' : 'scores'}${buzzer ? ' at the buzzer' : ''} (${reason})`,
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
      emit(m, {
        type: 'miss', team: s.team, hoop: { ...s.rim }, at: { ...s.from }, playerId: shooter.id,
        chance: s.chance, reason, clutch: s.clutch, buzzer,
        text: `${shooter.name} misses (${reason})`,
      });
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

/**
 * How much an AI carrier wants to get the human the ball, added to the
 * human's shot value when choosing a pass. A teammate looks harder when you
 * are open, when you have not touched it this trip, and most when you call.
 * Exported for tests.
 */
export function lookForHuman(m, carrier, human) {
  if (!human || human.team !== carrier.team || human === carrier) return 0;
  let v = 0.05;
  if (nearestDefenderDist(m, human) > 55) v += 0.15;
  if (!m.poss.touched) v += 0.15;
  if (carrier.callFor > m.time) v += 0.6;
  return v;
}

function laneBlocker(m, from, to) {
  let best = null;
  for (const d of m.teams[other(from.team)]) {
    const sd = segDist(d.pos, from.pos, to.pos);
    if (sd < 18 && (!best || sd < best.sd)) best = { d, sd };
  }
  return best ? best.d : null;
}

function thinkCarrier(m, p) {
  const rim = RIM[p.team];
  const toRim = dist(p.pos, rim);
  const h = m.human;

  if (p.think > 0) {
    if (!p.target) p.target = { ...rim };
    return;
  }
  p.think = 0.3 + m.rng() * 0.15;

  // A call gets an answer: the pass, or the reason it can't come.
  const called = p.team === h.team && p !== h && p.callFor > m.time;
  if (called && !p.callAnswered) {
    p.callAnswered = true;
    const blocker = laneBlocker(m, p, h);
    const marker = nearestDefender(m, h);
    const covered = marker && dist(marker.pos, h.pos) < 30;
    if (!blocker && !covered && m.rng() < 0.85) return pass(m, p, h);
    const why = blocker ? `${blocker.name} is in the lane` : covered ? `${marker.name} is all over you` : 'they like their own look';
    emit(m, { type: 'call', playerId: p.id, team: p.team, text: `${p.name} can't get it to you: ${why}` });
  }

  // The last second of a period: let it fly from wherever you are.
  if (m.clock < 1.2) return shoot(m, p);

  const teaching = m.tutorial && m.tutorial.hold && p.team === h.team;
  if (teaching) {
    // The tutorial opener: bring it up, then wait for the human to get open.
    p.target = spotFor(p.team, 0);
    if (m.shotClock < 3) return shoot(m, p);
    // It answers a call at once (above); unprompted, it gives you a few
    // seconds to try calling first.
    const waited = m.time - m.poss.start > 6;
    if (waited && inFrontCourt(p) && nearestDefenderDist(m, h) > 55 && !laneBlocker(m, p, h) && m.rng() < 0.15) pass(m, p, h);
    return;
  }

  if (!inFrontCourt(p)) {
    p.target = spotFor(p.team, 0);
    if (p.kit.R.id === 'fastbreak' && m.rng() < 0.2) cast(m, p, 'R');
    return;
  }

  // The shot a carrier will settle for gets worse as the clock runs; the
  // game clock counts too when it is shorter than the shot clock.
  const clockLeft = Math.min(m.shotClock, m.clock);
  const urgency = clamp((SHOT_CLOCK - clockLeft) / SHOT_CLOCK, 0, 1);
  const ev = (q) => shotChance(m, q) * shotPoints(q, q.pos);
  const mine = ev(p);
  if (clockLeft < 3 || toRim < 60 || mine >= lerp(1.0, 0.7, urgency)) {
    if (p.kit.R.id === 'limitless' && toRim > THREE_DIST && m.rng() < 0.5) cast(m, p, 'R');
    return shoot(m, p);
  }

  // Teammates look for the human, but not every time: vision is a roll, so
  // the AI does not feed you robotically.
  const sees = (q) => !q.isHuman || called || m.rng() < 0.75;
  let best = null;
  for (const q of m.teams[p.team]) {
    if (q === p || !sees(q) || q.denyUntil > m.time) continue;
    let v = ev(q);
    if (q.isHuman) v += lookForHuman(m, p, q);
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

/**
 * What the human should do right now, as one short line and a tone
 * (info | good | warn | urgent). Read off the same state the rules use, so it
 * is never wrong about the ball. Exported for tests.
 */
export function coachPrompt(m) {
  if (m.phase !== 'live') return null;
  const h = m.human;
  const b = m.ball;
  const carrier = holder(m);
  const clockLeft = Math.min(m.shotClock, m.clock);
  const pct = (v) => `${Math.round(v * 100)}%`;
  const ready = (s) => h.cd[s] <= 0 && h.stamina >= h.kit[s].cost;

  if (b.state === 'loose') {
    return dist(h.pos, b.pos) < 160 ? { text: 'Loose ball: right-click it to go get it', tone: 'warn' } : null;
  }
  if (b.state === 'shot') return null;

  if (carrier === h) {
    const sb = shotBreakdown(m, h);
    if (clockLeft <= 4) return { text: `${clockLeft === m.clock ? 'Period' : 'Shot clock'} ${Math.ceil(clockLeft)}: shoot (Space, ${pct(sb.chance)})`, tone: 'urgent' };
    if (!inFrontCourt(h)) return { text: 'Bring it up: right-click past half court', tone: 'info' };
    if (sb.label === 'open' && sb.chance >= 0.4) return { text: `Open: Space shoots ${pct(sb.chance)} for ${sb.points}`, tone: 'good' };
    if (sb.contest >= 0.1 && ready('Q')) return { text: `${sb.contestBy} is on you: Q to step back`, tone: 'warn' };
    let best = null;
    for (const q of m.teams[h.team]) {
      if (q === h || nearestDefenderDist(m, q) < 55 || laneBlocker(m, h, q)) continue;
      const v = shotChance(m, q);
      if (!best || v > best.v) best = { q, v };
    }
    if (best && best.v > sb.chance + 0.05) return { text: `${best.q.name} is open (${pct(best.v)}): left-click to pass`, tone: 'good' };
    return { text: `${pct(sb.chance)} here: drive closer or shoot`, tone: 'info' };
  }

  if (m.offense === h.team) {
    const marker = nearestDefender(m, h);
    const open = dist(marker.pos, h.pos) > 55;
    if (carrier && clockLeft <= 4) return { text: `Shot clock ${Math.ceil(clockLeft)}: get open for a last look`, tone: 'urgent' };
    if (carrier && open) return { text: `You're open: left-click ${carrier.name} to call for it`, tone: 'good' };
    return { text: `Get open: ${marker.name} is on you`, tone: 'info' };
  }

  const man = m.teams[other(h.team)][h.idx];
  const d = dist(h.pos, man.pos);
  if (carrier === man) {
    if (d <= STEAL_RANGE) return { text: `On ${man.name}: left-click him to reach (${pct(stealChance(m, h, man))})`, tone: 'good' };
    if (ready('E') && d < h.kit.E.distance + 40) return { text: `Your man has the ball: E to close out on ${man.name}`, tone: 'urgent' };
    return { text: `Your man has the ball: get to ${man.name}`, tone: 'urgent' };
  }
  if (d > 110) return { text: `Find your man: ${man.name}, at the end of the dashed line`, tone: 'warn' };
  return { text: `Deny ${man.name}: stay between him and the rim`, tone: 'info' };
}

function view(m) {
  const h = m.human;
  const carrier = holder(m);
  const toRender = (p) => ({ id: p.id, name: p.name, x: p.pos.x - 15, y: p.pos.y - 15, isHuman: p.isHuman, anim: animFor(m, p) });
  const man = m.teams[other(h.team)][h.idx];
  const shot = carrier === h ? shotBreakdown(m, h) : null;
  const clockLeft = Math.min(m.shotClock, m.clock);
  return {
    tick: m.tick,
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
      // The shot clock is off when less game clock than shot clock is left.
      shotClockOff: m.clock < m.shotClock,
      offense: m.offense,
      clutch: m.phase === 'live' && m.clock <= CLUTCH_SECONDS,
      buzzer: m.buzzer,
      urgent: m.phase === 'live' && clockLeft <= 4,
      rally: { home: rallying(m, 'home'), away: rallying(m, 'away'), deficit: RALLY_DEFICIT, bonus: RALLY_BONUS },
      possession: { n: m.poss.n, team: m.poss.team, touched: m.poss.touched, seconds: m.time - m.poss.start },
      prompt: coachPrompt(m),
      tutorial: m.tutorial ? { hold: m.tutorial.hold } : null,
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
        shotChance: shot ? shot.chance : null,
        shotPoints: shot ? shot.points : null,
        shot,
        man: { id: man.id, name: man.name, hasBall: carrier === man, distance: dist(h.pos, man.pos) },
        open: m.offense === h.team && nearestDefenderDist(m, h) > 55,
      },
      // When you have the ball: each teammate, whether they're open, and
      // whether the lane to them is clear.
      passLanes: carrier === h
        ? m.teams[h.team].filter((q) => q !== h).map((q) => {
          const blocker = laneBlocker(m, h, q);
          return { id: q.id, name: q.name, x: q.pos.x, y: q.pos.y, open: nearestDefenderDist(m, q) > 55, laneClear: !blocker, blockedBy: blocker ? blocker.name : null };
        })
        : [],
    },
    overlay: {
      human: { ...h.pos },
      marker: h.target ? { ...h.target } : null,
      man: m.offense !== h.team ? { ...man.pos } : null,
      zones: m.zones.map((z) => ({ ...z.center(), r: z.radius, team: z.team })),
      locks: m.all.filter((p) => p.lock).map((p) => ({ ...p.pos })),
      denies: m.all.filter((p) => p.denyUntil > m.time).map((p) => ({ ...p.pos })),
      stumbles: m.all.filter((p) => p.stumbleUntil > m.time).map((p) => ({ ...p.pos })),
    },
  };
}

/** Box-score lines for both teams, for the end screen. */
export function boxScore(match) {
  const m = match._m;
  const row = (p) => ({ id: p.id, name: p.name, isHuman: p.isHuman, ...p.line });
  return { home: m.teams.home.map(row), away: m.teams.away.map(row), score: { ...m.score } };
}
