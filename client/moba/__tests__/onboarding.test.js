/**
 * Full Court onboarding hints — no framework, plain Node:
 *   node client/moba/__tests__/onboarding.test.js
 *
 * The three hints clear in order when the player does the thing, can be
 * skipped, and remember they were seen even when storage misbehaves.
 */
import assert from 'node:assert/strict';
import { HINT_STEPS, HINTS_KEY, startHints, advanceHints, hintsSeen, markHintsSeen, hintText, controlsLine, forTouch } from '../onboarding.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const memoryStorage = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
};

test('three steps: move, get the ball, shoot or step back', () => {
  assert.deepEqual(HINT_STEPS.map((s) => s.id), ['move', 'ball', 'shoot']);
});

test('steps clear in order, on the action itself', () => {
  let s = startHints();
  s = advanceHints(s, { type: 'shot' });
  assert.equal(s.step, 0, 'shooting does not clear "move"');
  s = advanceHints(s, { type: 'move' });
  assert.equal(s.step, 1);
  s = advanceHints(s, { type: 'cast', slot: 'W' });
  assert.equal(s.step, 1, 'W is not the lesson');
  s = advanceHints(s, { type: 'hasBall' });
  assert.equal(s.step, 2);
  s = advanceHints(s, { type: 'cast', slot: 'Q' });
  assert.equal(s.done, true);
  assert.equal(s.skipped, false);
});

test('holding the ball first clears both "move" and "get the ball"', () => {
  const s = advanceHints(startHints(), { type: 'hasBall' });
  assert.equal(s.step, 2);
  assert.equal(s.done, false);
});

test('skip ends the run at any step, and done is final', () => {
  const s = advanceHints(advanceHints(startHints(), { type: 'move' }), { type: 'skip' });
  assert.equal(s.done, true);
  assert.equal(s.skipped, true);
  assert.equal(advanceHints(s, { type: 'move' }), s);
});

test('seen once per browser, and broken storage never throws', () => {
  const st = memoryStorage();
  assert.equal(hintsSeen(st), false);
  markHintsSeen(st);
  assert.equal(hintsSeen(st), true);
  assert.equal(st.getItem(HINTS_KEY), '1');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(hintsSeen(broken), false);
  assert.doesNotThrow(() => markHintsSeen(broken));
  assert.equal(hintsSeen(undefined), false);
  assert.doesNotThrow(() => markHintsSeen(null));
});

test('touch copy: every hint says tap, never click or a key it has no', () => {
  for (const step of HINT_STEPS) {
    const t = hintText(step, true);
    assert.ok(t && t !== step.text, `${step.id} has touch copy`);
    assert.doesNotMatch(t, /click|Space|Esc/i, `${step.id}: ${t}`);
    assert.equal(hintText(step, false), step.text, 'mouse copy is unchanged');
  }
  assert.match(hintText(HINT_STEPS[0], true), /^Tap the court to run there/);
  assert.doesNotMatch(controlsLine(true), /click|Space|Esc/i);
  assert.match(controlsLine(false), /Right-click to move/);
});

test('coach prompts translate to taps', () => {
  const cases = [
    ['Loose ball: right-click it to go get it', 'Loose ball: tap it to go get it'],
    ['Bring it up: right-click past half court', 'Bring it up: tap past half court'],
    ['Shot clock 4: shoot (Space, 38%)', 'Shot clock 4: shoot (38%)'],
    ['Open: Space shoots 52% for 3', 'Open: Shoot is 52% for 3'],
    ['Brunson is open (48%): left-click to pass', 'Brunson is open (48%): tap him to pass'],
    ["You're open: left-click Fox to call for it", "You're open: tap Fox to call for it"],
    ['On Fox: left-click him to reach (22%)', 'On Fox: tap him to reach (22%)'],
    ['Your man has the ball: E to close out on Fox', 'Your man has the ball: E to close out on Fox'],
  ];
  for (const [mouse, touch] of cases) assert.equal(forTouch(mouse), touch);
  assert.equal(forTouch(null), null);
});

console.log(`\n${passed} passed`);
