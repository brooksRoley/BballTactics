/**
 * One coverage call per round, and it is the one the sim uses.
 *   node client/game/__tests__/coverageCall.test.js
 *
 * The build review (2026-10-20, Weak #1) found coverage asked three times in
 * a round: a planning picker, the scouting report's "Your coverage call", and
 * a pre-fight picker that said the ref didn't enforce it. Now the scouting
 * report is the only picker; startBattle passes that call to roundMatchups,
 * whose away multiplier scales the ghost's shooting; the pre-fight panel only
 * displays it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundMatchups, resolveMatchup, schemes } from '../tactics.js';
import { coverageCall, COVERAGE_GLOW } from '../coveragePreview.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', '..', p), 'utf8');

const u = (id, name, shooting, speed, defense, courtX, courtY) => ({
  id, name, cost: 3, stats: { shooting, speed, defense }, courtX, courtY,
});
const MINE = [u(1, 'A', 62, 55, 48, 2, 1), u(2, 'B', 55, 60, 50, 1, 3), u(3, 'C', 50, 45, 66, 2, 4)];
const THEIRS = [u(11, 'X', 70, 58, 40, 2, 1), u(12, 'Y', 52, 64, 45, 3, 2), u(13, 'Z', 44, 40, 70, 2, 4)];
const round = (myCoverage) => roundMatchups({
  myOffense: 'spread_pnr', myCoverage,
  theirOffense: 'delay_5out', theirCoverage: 'ice',
  myUnits: MINE, theirUnits: THEIRS,
});

test('the away multiplier is their offense resolved against MY coverage call', () => {
  for (const c of schemes.coverages) {
    const { away } = round(c.id);
    assert.deepEqual(away, resolveMatchup('delay_5out', c.id, THEIRS, MINE), c.id);
    assert.ok(away.notes[0].includes(c.name), away.notes[0]);
  }
});

test('my coverage call changes their multiplier and nothing on my side', () => {
  const homes = new Set(schemes.coverages.map((c) => round(c.id).home.offenseMultiplier));
  const aways = new Set(schemes.coverages.map((c) => round(c.id).away.offenseMultiplier));
  assert.equal(homes.size, 1, 'home side must not depend on my coverage');
  assert.ok(aways.size > 1, 'the call has to matter');
  // Delay 5-Out: 2-3 Zone is the book stop (0.90), Blitz its counter (1.12).
  assert.ok(round('zone23').away.offenseMultiplier < round('blitz').away.offenseMultiplier);
});

test('the home multiplier is my offense against THEIR coverage', () => {
  assert.deepEqual(round('drop').home, resolveMatchup('spread_pnr', 'ice', MINE, THEIRS));
});

test('every coverage has a glow, and the panel names the real call', () => {
  for (const c of schemes.coverages) {
    assert.ok(COVERAGE_GLOW[c.id], `no glow for ${c.id}`);
    assert.equal(coverageCall(c.id).name, c.name);
  }
  assert.deepEqual(Object.keys(COVERAGE_GLOW).sort(), schemes.coverages.map((c) => c.id).sort());
});

test('the panel states the multiplier the sim uses', () => {
  const m = round('zone23').away.offenseMultiplier;
  const call = coverageCall('zone23', m);
  assert.equal(call.effectPct, Math.round((m - 1) * 100));
  assert.ok(call.effectPct < 0);
  assert.match(call.effectText, /cuts their shooting \d+%/);
  assert.match(coverageCall('blitz', 1.12).effectText, /gives up 12%/);
  assert.match(coverageCall('drop', 1).effectText, /even/);
});

test('coverage is picked in exactly one place', () => {
  const app = src('App.vue');
  const canvas = src('components/CourtCanvas.vue');
  assert.equal(app.match(/v-model="myCoverage"/g)?.length, 1, 'one coverage picker in App.vue');
  const scout = app.slice(app.indexOf(`phase === 'scout'`));
  assert.ok(scout.indexOf('v-model="myCoverage"') < scout.indexOf('startBattle'), 'the picker is on the scouting report');
  assert.ok(!/enforce/i.test(canvas), 'no "the ref doesn\'t enforce it" copy');
  assert.ok(!/selectScheme|coverage-btn/.test(canvas), 'no second picker in the pre-fight panel');
  assert.match(app, /:coverage="myCoverage"/, 'the pre-fight panel shows the scouting call');
  assert.match(app, /roundMatchups\(\{[\s\S]*?myCoverage: myCoverage\.value/, 'startBattle passes the call to the sim');
});

console.log(`\n${passed} passed`);
