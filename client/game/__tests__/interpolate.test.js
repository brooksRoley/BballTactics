/**
 * Fixed-timestep + render-interpolation tests — no framework, plain Node:
 *   node client/game/__tests__/interpolate.test.js
 *
 * Proves the sim only ever steps in exact substeps, that the same seeded
 * fight ends identically at 60 Hz and 120 Hz frames, and that interpolation
 * blends motion but snaps across teleports.
 */
import assert from 'node:assert/strict';
import { createFixedStepper, interpolateState, SNAP_DIST } from '../interpolate.js';
import { createFallbackSim } from '../fallbackSim.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

const SUBSTEP = 1 / 60;
const SIM_SPEED = 2.5;

const unit = (name, courtX, courtY) => ({
  name, courtX, courtY, stats: { speed: 55, shooting: 55, defense: 45 },
});
const OPTS = {
  homeUnits: [unit('Home Alpha', 1, 1), unit('Home Bravo', 2, 2), unit('Home Charlie', 3, 3)],
  awayUnits: [unit('Ghost Aldrin', 1, 1), unit('Ghost Baker', 2, 2), unit('Ghost Collins', 3, 3)],
  homeMultiplier: 1, awayMultiplier: 1, seed: 1234,
};

// Mirror CourtCanvas.syncLoop: wall dt → sim dt, fixed substeps.
const playFight = (hz, seconds) => {
  const sim = createFallbackSim(OPTS);
  const dts = [];
  const stepper = createFixedStepper({
    substep: SUBSTEP, maxSteps: 8,
    tick: (dt) => { dts.push(dt); sim.step(dt); },
    read: () => sim.getState(),
  });
  stepper.reset(sim.getState());
  for (let f = 0; f < seconds * hz; f++) stepper.advance(Math.min(1 / hz, 0.05) * SIM_SPEED);
  return { state: stepper.cur, steps: stepper.totalSteps, dts };
};

test('every tick is exactly one substep', () => {
  const { dts } = playFight(144, 2);
  assert.ok(dts.length > 0);
  assert.ok(dts.every((dt) => dt === SUBSTEP));
});

test('same seed plays the same at 60 Hz and 120 Hz', () => {
  const a = playFight(60, 30);
  const b = playFight(120, 30);
  assert.equal(a.steps, 30 * SIM_SPEED * 60);
  assert.equal(a.steps, b.steps);
  assert.deepEqual(a.state, b.state);
  assert.ok(a.state.homeScore + a.state.awayScore > 0, 'nobody scored');
});

test('a stall is capped, not replayed', () => {
  let ticks = 0;
  const s = createFixedStepper({ substep: SUBSTEP, maxSteps: 8, tick: () => ticks++, read: () => ({}) });
  const { steps, alpha } = s.advance(5);
  assert.equal(steps, 8);
  assert.equal(ticks, 8);
  assert.ok(alpha >= 0 && alpha < 1);
  assert.equal(s.advance(0).steps, 0);
});

test('prev is exactly one step behind cur', () => {
  let n = 0;
  const s = createFixedStepper({ substep: SUBSTEP, maxSteps: 8, tick: () => n++, read: () => ({ n }) });
  s.reset({ n: 0 });
  s.advance(SUBSTEP * 3.5);
  assert.equal(s.cur.n, 3);
  assert.equal(s.prev.n, 2);
  s.advance(SUBSTEP);
  assert.equal(s.cur.n, 4);
  assert.equal(s.prev.n, 3);
});

const st = (px, bx, extra = {}) => ({
  players: [{ id: 1, name: 'A', x: px, y: 0 }],
  bots: [{ id: 9, name: 'G', x: px, y: 10 }],
  ball: { x: bx, y: 0, z: 0, possessorId: 1, isPossessed: true },
  homeScore: 0, awayScore: 0, ...extra,
});

test('positions blend by alpha, everything else comes from cur', () => {
  const v = interpolateState(st(0, 0), st(4, 4, { homeScore: 2 }), 0.25);
  assert.equal(v.players[0].x, 1);
  assert.equal(v.bots[0].x, 1);
  assert.equal(v.bots[0].y, 10);
  assert.equal(v.ball.x, 1);
  assert.equal(v.homeScore, 2);
  assert.equal(v.players[0].name, 'A');
});

test('a teleport snaps to cur instead of sliding', () => {
  const v = interpolateState(st(0, 0), st(4, 400), 0.5);
  assert.equal(v.ball.x, 400);
  assert.equal(v.players[0].x, 2);
  assert.ok(SNAP_DIST < 400);
});

test('entities are matched by id, new ones drawn at cur', () => {
  const prev = st(0, 0);
  const cur = st(4, 4);
  cur.players = [{ id: 2, x: 50, y: 0 }, { id: 1, x: 4, y: 0 }];
  const v = interpolateState(prev, cur, 0.5);
  assert.equal(v.players[0].x, 50);
  assert.equal(v.players[1].x, 2);
});

test('no prev, or alpha 1, returns cur untouched', () => {
  const cur = st(4, 4);
  assert.equal(interpolateState(null, cur, 0.5), cur);
  assert.equal(interpolateState(st(0, 0), cur, 1), cur);
});

console.log(`\n${passed} passed`);
