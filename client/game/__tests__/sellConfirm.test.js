/**
 * Two-step sell for bench cards — plain Node:
 *   node client/game/__tests__/sellConfirm.test.js
 *
 * Regression: on a phone, one tap on the centre of a bench card landed on its
 * Sell button and sold the player. A single press must never sell.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SELL_CONFIRM_MS, pressSell, armedSellId, sellLabel } from '../sellConfirm.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

test('one press never sells; it only arms that player', () => {
  const r = pressSell(null, 7, 1000);
  assert.equal(r.sell, false);
  assert.deepEqual(r.state, { id: 7, at: 1000 });
  assert.equal(armedSellId(r.state, 1000), 7);
});

test('a second press on the same player inside the window sells and disarms', () => {
  const armed = pressSell(null, 7, 1000).state;
  const r = pressSell(armed, 7, 1000 + SELL_CONFIRM_MS - 1);
  assert.equal(r.sell, true);
  assert.equal(r.state, null);
});

test('the second press after the window re-arms instead of selling', () => {
  const armed = pressSell(null, 7, 1000).state;
  assert.equal(armedSellId(armed, 1000 + SELL_CONFIRM_MS + 1), null);
  const r = pressSell(armed, 7, 1000 + SELL_CONFIRM_MS + 1);
  assert.equal(r.sell, false);
  assert.equal(r.state.id, 7);
});

test('pressing another player moves the arm; neither is sold', () => {
  const a = pressSell(null, 7, 1000).state;
  const r = pressSell(a, 8, 1200);
  assert.equal(r.sell, false);
  assert.equal(armedSellId(r.state, 1200), 8);
  const back = pressSell(r.state, 7, 1300);
  assert.equal(back.sell, false, 'switching back to 7 starts over');
});

test('labels say when a press will sell', () => {
  assert.equal(sellLabel(false, 3, 'A One').text, 'Sell 3G');
  assert.equal(sellLabel(true, 3, 'A One').text, 'Sell? 3G');
  assert.match(sellLabel(false, 3, 'A One').aria, /press twice/);
  assert.match(sellLabel(true, 3, 'A One').aria, /^Confirm: sell A One for 3 gold$/);
});

// The bench card itself must not emit a sale on its own click path: the only
// emit of 'sell-player' in PlanningPhase must sit behind pressSell().
test('PlanningPhase routes every sale through pressSell', () => {
  const src = readFileSync(new URL('../../components/PlanningPhase.vue', import.meta.url), 'utf8');
  const emits = src.match(/emit\(\s*'sell-player'/g) || [];
  assert.equal(emits.length, 1, 'exactly one sell-player emit');
  assert.ok(!/\$emit\(\s*'sell-player'/.test(src), 'no direct $emit from the template');
  const fn = src.slice(src.indexOf('const onSellPress'), src.indexOf("emit('sell-player'"));
  assert.ok(fn.includes('pressSell('), "the emit sits inside onSellPress after pressSell()");
});

console.log(`sellConfirm: ${passed} passed`);
