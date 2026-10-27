/**
 * Full Court animation-state tests — plain Node:
 *   node client/moba/__tests__/anim.test.js
 *
 * anim.js only reads match state. These check that looking at a match never
 * changes how it plays, and that each action the renderer draws a pose for
 * is reported when it happens.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMatch, boxScore } from '../match.js';

const roster = JSON.parse(readFileSync(new URL('../../../public/engine_roster.json', import.meta.url)));
const byName = (n) => roster.find((p) => p.name === n);

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const frameOf = (v, id) => [...v.players, ...v.bots].find((p) => p.id === id);

test('viewing every tick does not change the game', () => {
  const play = (look) => {
    const mt = createMatch({ roster, humanId: byName('Jalen Brunson').id, seed: 77, quarterLength: 20 });
    for (let i = 0; i < 60 * 120 && mt._m.phase !== 'final'; i++) {
      if (i % 90 === 0) mt.command({ type: 'move', x: 600 - (i % 400), y: 120 + (i % 160) });
      if (i % 240 === 0) mt.command({ type: 'shoot' });
      mt.step(1 / 60);
      if (look) mt.view();
    }
    return JSON.stringify(boxScore(mt));
  };
  assert.equal(play(true), play(false));
});

test('every player frame carries a facing, velocity and action', () => {
  const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 3 });
  mt.step(0.5);
  for (const p of [...mt.view().players, ...mt.view().bots]) {
    assert.ok(Number.isFinite(p.anim.facing));
    assert.ok(Number.isFinite(p.anim.vx) && Number.isFinite(p.anim.vy));
    assert.ok(['idle', 'run', 'dribble', 'shoot', 'reach', 'dash', 'celebrate', 'guard'].includes(p.anim.action));
  }
  const me = frameOf(mt.view(), mt._m.human.id);
  assert.equal(me.isHuman, true);
  assert.equal(me.anim.action, 'dribble', 'the human tips off with the ball');
});

test('a moving player runs and faces where they are going', () => {
  const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 3 });
  const m = mt._m;
  m.ball.holder = m.teams.home[1].id; // hand the ball off so the human is just running
  mt.command({ type: 'move', x: m.human.pos.x, y: m.human.pos.y + 150 });
  mt.step(1 / 60);
  const a = frameOf(mt.view(), m.human.id).anim;
  assert.equal(a.action, 'run');
  assert.ok(Math.abs(a.facing - Math.PI / 2) < 0.05, `facing ${a.facing} should point down the screen`);
  assert.ok(a.vy > 100);
});

test('a shot shows the jump-shot pose, facing the rim', () => {
  const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 9 });
  mt.command({ type: 'shoot' });
  mt.step(0.1);
  const a = frameOf(mt.view(), mt._m.human.id).anim;
  assert.equal(a.action, 'shoot');
  assert.ok(a.t > 0 && a.t < 1);
  assert.ok(Math.cos(a.facing) > 0.5, 'home shoots at the right-hand rim');
});

test('step-back and burst show as a dash and a buff', () => {
  const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 8 });
  const h = mt._m.human;
  mt.command({ type: 'cast', slot: 'W', x: 0, y: 0 });
  mt.command({ type: 'cast', slot: 'Q', x: h.pos.x + 50, y: h.pos.y });
  mt.step(1 / 60);
  const a = frameOf(mt.view(), h.id).anim;
  assert.equal(a.action, 'dash');
  assert.equal(a.kind, 'stepback');
  assert.ok(a.vx < 0, 'steps back away from the cursor');
  assert.ok(Math.cos(a.facing) > 0.9, 'keeps facing the cursor while stepping back');
  assert.ok(a.buffs.burst > 0 && a.buffs.stepback > 0);
});

test('a made shot makes the shooter celebrate', () => {
  for (let seed = 1; seed < 60; seed++) {
    const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed });
    const m = mt._m;
    m.human.pos = { x: 760, y: 200 }; // at the rim: a high-percentage look
    mt.command({ type: 'shoot' });
    let made = false;
    for (let i = 0; i < 60 && !made; i++) {
      mt.step(1 / 60);
      made = mt.drainEvents().some((e) => e.type === 'make');
    }
    if (!made) continue;
    assert.equal(frameOf(mt.view(), m.human.id).anim.action, 'celebrate');
    return;
  }
  assert.fail('no make in 60 seeds');
});

console.log(`\n${passed} passed`);
