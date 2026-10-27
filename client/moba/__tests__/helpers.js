/**
 * Shared helpers for the Full Court determinism and fuzz tests (not a test
 * file itself: the runner only picks up *.test.js).
 */
import { readFileSync } from 'node:fs';
import { COURT_W, COURT_H } from '../match.js';

export const roster = JSON.parse(readFileSync(new URL('../../../public/engine_roster.json', import.meta.url)));
export const byName = (n) => roster.find((p) => p.name === n);

/** mulberry32 for the test drivers, kept apart from the match's own RNG. */
export function driverRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * A stand-in human: reads the court the way a person reads the screen and
 * returns one command (or null). Moves to space, calls for the ball, shoots,
 * steps back, closes out, reaches, and fires W and R now and then, so a log
 * it produces exercises every command type.
 */
export function standInDecide(match, rng) {
  const m = match._m;
  if (m.phase !== 'live') return null;
  const h = m.human;
  const b = m.ball;
  const carrier = b.state === 'held' ? m.byId.get(b.holder) : null;
  const ready = (s) => h.cd[s] <= 0 && h.stamina >= h.kit[s].cost;
  const ownRim = h.team === 'home' ? { x: 780, y: 200 } : { x: 20, y: 200 };
  const r = rng();
  if (b.state === 'loose') return { type: 'move', x: b.pos.x, y: b.pos.y };
  if (carrier === h) {
    if (r < 0.08 && ready('Q')) return { type: 'cast', slot: 'Q', x: ownRim.x, y: ownRim.y };
    if (r < 0.12 && ready('W')) return { type: 'cast', slot: 'W' };
    if (r < 0.16 && ready('R')) return { type: 'cast', slot: 'R', x: ownRim.x, y: ownRim.y };
    if (r < 0.3) {
      const mates = m.teams[h.team].filter((q) => q !== h);
      const q = mates[Math.floor(rng() * mates.length)];
      return { type: 'click', x: q.pos.x, y: q.pos.y };
    }
    if (r < 0.55 && dist(h.pos, ownRim) < 260) return { type: 'shoot' };
    return { type: 'move', x: ownRim.x - 60, y: ownRim.y + (rng() - 0.5) * 160 };
  }
  if (m.offense === h.team) {
    if (carrier && r < 0.2) return { type: 'click', x: carrier.pos.x, y: carrier.pos.y };
    if (r < 0.25 && ready('W')) return { type: 'cast', slot: 'W' };
    return { type: 'move', x: ownRim.x + (h.team === 'home' ? -1 : 1) * (60 + rng() * 160), y: 40 + rng() * (COURT_H - 80) };
  }
  const man = m.teams[h.team === 'home' ? 'away' : 'home'][h.idx];
  if (carrier && dist(carrier.pos, h.pos) < 34 && r < 0.4) return { type: 'click', x: carrier.pos.x, y: carrier.pos.y };
  if (carrier === man && r < 0.15 && ready('E')) return { type: 'cast', slot: 'E', x: man.pos.x, y: man.pos.y };
  if (r < 0.05 && ready('R')) return { type: 'cast', slot: 'R', x: h.pos.x, y: h.pos.y };
  return { type: 'move', x: (man.pos.x + (COURT_W - ownRim.x)) / 2, y: (man.pos.y + 200) / 2 };
}

/**
 * Anything at all a client (or a broken peer) might send: valid commands
 * with wild coordinates, and garbage. The rules must survive all of it.
 */
export function randomCommand(m, rng) {
  const pick = (xs) => xs[Math.floor(rng() * xs.length)];
  const wild = () => {
    const r = rng();
    if (r < 0.03) return pick([NaN, Infinity, -Infinity, 1e12, -1e12, undefined, '300', null]);
    if (r < 0.15) return rng() * 3000 - 1000;
    return rng() * COURT_W;
  };
  const r = rng();
  if (r < 0.03) return pick([null, undefined, 42, 'move', {}, { type: 'teleport', x: 1, y: 1 }, { type: 'cast', slot: 'X' }]);
  if (r < 0.35) return { type: 'move', x: wild(), y: wild() * 0.5 };
  if (r < 0.6) {
    // Click on a player (pass, call, reach) or anywhere.
    if (rng() < 0.6) {
      const p = pick(m.all);
      return { type: 'click', x: p.pos.x + (rng() - 0.5) * 20, y: p.pos.y + (rng() - 0.5) * 20 };
    }
    return { type: 'click', x: wild(), y: wild() * 0.5 };
  }
  if (r < 0.8) return { type: 'cast', slot: pick(['Q', 'W', 'E', 'R']), ...(rng() < 0.8 ? { x: wild(), y: wild() * 0.5 } : {}) };
  if (r < 0.95) return { type: 'shoot' };
  return { type: 'stop' };
}

/** Frame-time patterns: steady 30, 60 and 144 fps, and a jittery one. */
export const FRAME_PATTERNS = {
  '30 fps': () => () => 1 / 30,
  '60 fps': () => () => 1 / 60,
  '144 fps': () => () => 1 / 144,
  jitter: (seed = 7) => {
    const rng = driverRng(seed);
    // Mostly 8–40 ms, with the odd long hitch (a tab switch, a GC pause).
    return () => (rng() < 0.03 ? 0.1 + rng() * 0.3 : 0.008 + rng() * 0.032);
  },
};
