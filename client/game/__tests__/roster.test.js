// Data-source contract tests for engine_roster.json.
// Standalone: `node client/game/__tests__/roster.test.js` — no dependencies.
//
// Validates the roster against shared-core/schema/engine_roster.schema.json
// (hand-rolled checks mirroring the schema — no ajv dependency) and, when the
// zero-next repo is present, asserts the API-served copy has not drifted from
// this repo's copy. The client prefers the API roster, so drift there is a
// live bug: a copy missing `team` silently disables franchise synergies.

import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

const schema = JSON.parse(readFileSync(join(repoRoot, 'shared-core/schema/engine_roster.schema.json'), 'utf8'));
const roster = JSON.parse(readFileSync(join(repoRoot, 'public/engine_roster.json'), 'utf8'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    failed++;
  }
}

console.log('roster.test.js');
console.log(`  roster: ${roster.length} players`);

// ── Schema conformance (mirrors engine_roster.schema.json) ──────────────────

const allowedKeys = new Set(Object.keys(schema.items.properties));
const allowedStatKeys = new Set(Object.keys(schema.items.properties.stats.properties));
const statBounds = schema.items.properties.stats.properties; // {shooting:{minimum,maximum},...}
const costBounds = schema.items.properties.cost;

test('roster is a non-empty array', () => {
  assert.ok(Array.isArray(roster) && roster.length > 0);
});

test('every player has the required fields (id, name, cost, stats)', () => {
  for (const p of roster) {
    for (const k of schema.items.required) {
      assert.ok(k in p, `player ${JSON.stringify(p.name || p.id)} missing "${k}"`);
    }
  }
});

test('no player carries fields outside the schema contract', () => {
  for (const p of roster) {
    for (const k of Object.keys(p)) {
      assert.ok(allowedKeys.has(k), `player ${p.id} has undeclared field "${k}" — update the schema or the producer`);
    }
    for (const k of Object.keys(p.stats)) {
      assert.ok(allowedStatKeys.has(k), `player ${p.id} has undeclared stat "${k}"`);
    }
  }
});

test('ids are unique positive integers', () => {
  const seen = new Set();
  for (const p of roster) {
    assert.ok(Number.isInteger(p.id) && p.id > 0, `bad id ${p.id}`);
    assert.ok(!seen.has(p.id), `duplicate id ${p.id}`);
    seen.add(p.id);
  }
});

test(`costs stay in the ${costBounds.minimum}-${costBounds.maximum} gold band`, () => {
  for (const p of roster) {
    assert.ok(Number.isInteger(p.cost) && p.cost >= costBounds.minimum && p.cost <= costBounds.maximum,
      `${p.name}: cost ${p.cost}`);
  }
});

test('every stat is an integer inside its schema bounds', () => {
  for (const p of roster) {
    for (const [stat, bounds] of Object.entries(statBounds)) {
      const v = p.stats[stat];
      assert.ok(Number.isInteger(v) && v >= bounds.minimum && v <= bounds.maximum,
        `${p.name}: ${stat}=${v} outside [${bounds.minimum}, ${bounds.maximum}]`);
    }
  }
});

test('every cost tier 1-5 is purchasable (shop odds depend on it)', () => {
  const tiers = new Set(roster.filter(p => p.is_active !== false).map(p => p.cost));
  for (let c = 1; c <= 5; c++) assert.ok(tiers.has(c), `no active player at cost ${c}`);
});

test('franchise synergies have fuel: >=1 team fields present and >=1 team with 2+ players', () => {
  const byTeam = {};
  for (const p of roster) {
    if (p.team) byTeam[p.team] = (byTeam[p.team] || 0) + 1;
  }
  const teams = Object.keys(byTeam);
  assert.ok(teams.length > 0, 'no player has a team — franchise synergies can never trigger');
  assert.ok(Object.values(byTeam).some(n => n >= 2),
    'no franchise has 2+ players — synergy buffs are unreachable');
});

// ── Cross-repo drift (the API-served copy must match this one) ──────────────

const zeroNextRoster = process.env.ZERO_NEXT_DIR
  ? join(process.env.ZERO_NEXT_DIR, 'public/engine_roster.json')
  : join(repoRoot, '..', 'zero-next', 'public/engine_roster.json');

if (existsSync(zeroNextRoster)) {
  test('zero-next API copy is byte-identical to this repo\'s roster', () => {
    const theirs = JSON.parse(readFileSync(zeroNextRoster, 'utf8'));
    assert.deepStrictEqual(theirs, roster,
      'rosters drifted — the client prefers the API copy; sync zero-next/public/engine_roster.json from this repo');
  });
} else {
  console.log('  skip  zero-next drift check (repo not found; set ZERO_NEXT_DIR to enable)');
}

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) process.exit(1);
