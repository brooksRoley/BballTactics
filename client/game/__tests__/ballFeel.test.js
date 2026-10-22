/**
 * Standalone tests for the ball-feel curves in client/fx/feel.js.
 * Run with:  node client/game/__tests__/ballFeel.test.js
 */

import assert from 'node:assert/strict';
import { FEEL, dribbleHeight, squashScale, ballShadow } from '../../fx/feel.js';

const cfg = FEEL.ball;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// Dribble: on the floor at t=0, in the hand half a bounce later, never outside [0, amp].
assert.ok(near(dribbleHeight(0), 0));
const periodMs = 1000 / cfg.dribbleHz;
assert.ok(near(dribbleHeight(periodMs / 2), cfg.dribbleAmp));
assert.ok(near(dribbleHeight(periodMs), 0, 1e-6));
for (let t = 0; t < 3000; t += 7) {
  const h = dribbleHeight(t);
  assert.ok(h >= 0 && h <= cfg.dribbleAmp + 1e-9, `dribble ${h} out of range at ${t}`);
}

// Squash: widest at contact, round again by squashMs, monotonic in between.
const s0 = squashScale(0);
assert.ok(near(s0.sx, 1 + cfg.squashAmount) && near(s0.sy, 1 - cfg.squashAmount));
assert.deepEqual(squashScale(cfg.squashMs), { sx: 1, sy: 1 });
assert.deepEqual(squashScale(cfg.squashMs * 4), { sx: 1, sy: 1 });
let prev = Infinity;
for (let t = 0; t <= cfg.squashMs; t += 5) {
  const { sx } = squashScale(t);
  assert.ok(sx <= prev + 1e-12, 'squash must ease back monotonically');
  prev = sx;
}

// Shadow: full on the floor, shrinks + fades with height, floored at shadowMinScale.
assert.deepEqual(ballShadow(0), { scale: 1, alpha: cfg.shadowMaxAlpha });
assert.ok(ballShadow(10).scale < 1 && ballShadow(10).alpha < cfg.shadowMaxAlpha);
assert.ok(ballShadow(20).scale < ballShadow(10).scale);
assert.equal(ballShadow(1000).scale, cfg.shadowMinScale);
assert.deepEqual(ballShadow(-5), ballShadow(0));

console.log('ballFeel: all tests passed');
