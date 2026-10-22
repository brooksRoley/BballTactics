/**
 * Standalone game-feel event detection tests — no framework, plain Node:
 *   node client/game/__tests__/events.test.js
 *
 * detectEvents compares two consecutive sim states; these pin down which
 * frame transitions count as a make, a miss, a steal — and which don't.
 */
import assert from 'node:assert/strict';
import { detectEvents, isGameWinner, RIMS } from '../events.js';
import { createFallbackSim } from '../fallbackSim.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

// Home ids 1-2, away ids 11-12. Engine top-left coordinates.
const state = (over = {}) => ({
  players: [{ id: 1, name: 'Home A', x: 600, y: 180 }, { id: 2, name: 'Home B', x: 500, y: 100 }],
  bots: [{ id: 11, name: 'Away A', x: 620, y: 190 }, { id: 12, name: 'Away B', x: 300, y: 300 }],
  ball: { x: 609, y: 189, z: 0, possessorId: 1, isPossessed: true },
  homeScore: 0,
  awayScore: 0,
  lastScorerId: -1,
  ...over,
});

test('first frame and quiet frames produce no events', () => {
  assert.deepEqual(detectEvents(null, state()), []);
  const a = state();
  const b = state({ ball: { ...a.ball, x: 612 } }); // carrier dribbles on
  assert.deepEqual(detectEvents(a, b), []);
});

test('a home make: points, team, right rim, floater at the scorer', () => {
  const a = state();
  // Engine: ball teleports to mid-court, other team inbounds, same tick.
  const b = state({
    homeScore: 3,
    lastScorerId: 1,
    ball: { x: 394, y: 194, z: 0, possessorId: 11, isPossessed: true },
  });
  const ev = detectEvents(a, b);
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0], { type: 'make', points: 3, team: 'home', hoop: RIMS.right, at: { x: 615, y: 195 } });
});

test('an away make goes to the left rim; the inbound flip is not a steal', () => {
  const a = state({ ball: { x: 300, y: 300, z: 0, possessorId: 12 } });
  const b = state({ awayScore: 2, lastScorerId: 12, ball: { x: 394, y: 194, z: 0, possessorId: 1 } });
  const ev = detectEvents(a, b);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'make');
  assert.equal(ev[0].team, 'away');
  assert.equal(ev[0].points, 2);
  assert.deepEqual(ev[0].hoop, RIMS.left);
});

test('a miss: the launch is silent, the shudder lands with the ball', () => {
  const held = state();
  const launched = state({ ball: { x: 609, y: 189, z: 2, possessorId: -1, isPossessed: false } });
  const apex = state({ ball: { x: 700, y: 195, z: 14, possessorId: -1, isPossessed: false } });
  const landed = state({ ball: { x: 760, y: 210, z: 0, possessorId: -1, isPossessed: false } });
  assert.deepEqual(detectEvents(held, launched), []);
  assert.deepEqual(detectEvents(launched, apex), []);
  const ev = detectEvents(apex, landed);
  assert.deepEqual(ev, [{ type: 'miss', hoop: RIMS.right }]);
  // A rebound off the floor afterwards is neither a miss nor a steal.
  const rebound = state({ ball: { x: 760, y: 210, z: 0, possessorId: 11 } });
  assert.deepEqual(detectEvents(landed, rebound), []);
});

test('engine flight: a shot ending at the rim without points is the miss', () => {
  const inAir = state({ ball: { x: 700, y: 195, z: 9, possessorId: -1, isPossessed: false, flight: 'shot' } });
  const atRim = state({ ball: { x: 760, y: 189, z: 8, possessorId: -1, isPossessed: false, flight: 'none' } });
  assert.deepEqual(detectEvents(inAir, atRim), [{ type: 'miss', hoop: RIMS.right }]);
  // The carom coming down afterwards is not a second miss.
  const down = state({ ball: { x: 740, y: 210, z: 0, possessorId: -1, isPossessed: false, flight: 'none' } });
  assert.deepEqual(detectEvents(atRim, down), []);
});

test('engine flight: a made shot is a make only, and a caught pass is nothing', () => {
  const inAir = state({ ball: { x: 700, y: 195, z: 9, possessorId: -1, isPossessed: false, flight: 'shot' } });
  const scored = state({ homeScore: 2, lastScorerId: 1, ball: { x: 30, y: 189, z: 0, possessorId: -1, isPossessed: false, flight: 'pass' } });
  assert.deepEqual(detectEvents(inAir, scored).map((e) => e.type), ['make']);
  const passing = state({ ball: { x: 560, y: 150, z: 1.4, possessorId: -1, isPossessed: false, flight: 'pass' } });
  const caught = state({ ball: { x: 500, y: 100, z: 0, possessorId: 2, isPossessed: true, flight: 'none' } });
  assert.deepEqual(detectEvents(passing, caught), []);
});

test('a steal: possession flips to a defender with no score change', () => {
  const a = state();
  const b = state({ ball: { x: 620, y: 190, z: 0, possessorId: 11 } });
  assert.deepEqual(detectEvents(a, b), [{ type: 'steal', team: 'away', at: { x: 635, y: 205 } }]);
});

test('a pass to a teammate is not a steal', () => {
  const a = state();
  const b = state({ ball: { x: 500, y: 100, z: 0, possessorId: 2 } });
  assert.deepEqual(detectEvents(a, b), []);
});

test('backup ref: make points sum to the final score, and misses are seen', () => {
  const unit = (name, courtX, courtY) => ({ name, courtX, courtY, stats: { speed: 45, shooting: 60, defense: 45 } });
  const sim = createFallbackSim({
    homeUnits: [unit('H1', 1, 1), unit('H2', 2, 2), unit('H3', 3, 3)],
    awayUnits: [unit('A1', 1, 1), unit('A2', 2, 2), unit('A3', 3, 3)],
    seed: 7,
  });
  let prev = sim.step(0);
  let makePts = 0;
  let misses = 0;
  for (let i = 0; i < 60 * 30; i++) {
    const next = sim.step(1 / 60);
    for (const e of detectEvents(prev, next)) {
      if (e.type === 'make') makePts += e.points;
      if (e.type === 'miss') misses++;
    }
    prev = next;
  }
  assert.equal(makePts, prev.homeScore + prev.awayScore);
  assert.ok(makePts > 0 && misses > 0, `makes ${makePts}, misses ${misses}`);
});

test('isGameWinner: OT basket, buzzer go-ahead, but not an early or losing make', () => {
  const opts = { overtime: false, homeScore: 10, awayScore: 8, now: 12, window: 1.5 };
  assert.equal(isGameWinner({ team: 'home', tookLead: true, t: 11 }, opts), true);
  assert.equal(isGameWinner({ team: 'home', tookLead: true, t: 5 }, opts), false);
  assert.equal(isGameWinner({ team: 'home', tookLead: false, t: 11.9 }, opts), false);
  assert.equal(isGameWinner({ team: 'away', tookLead: false, t: 11.9 }, opts), false);
  assert.equal(isGameWinner({ team: 'away', tookLead: true, t: 0 }, { ...opts, overtime: true, awayScore: 12 }), true);
  assert.equal(isGameWinner({ team: 'home', tookLead: true, t: 11 }, { ...opts, awayScore: 10 }), false);
  assert.equal(isGameWinner(null, opts), false);
});

console.log(`\nevents.test.js: ${passed} tests passed`);
