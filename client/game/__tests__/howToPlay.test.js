/**
 * Open Gym's words must match the rules — plain Node:
 *   node client/game/__tests__/howToPlay.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SHOP_SIZE, BENCH_CAP, REROLL_COST, BASE_INCOME, INTEREST_CAP, STARTING_GOLD, MAX_ROUNDS, STAR_MULTIPLIER, teamSizeCap,
} from '../economy.js';
import schemes from '../schemes.json' with { type: 'json' };
import { howToPlayCards, CONTROLS_TOUR, PITCH, START_HP, LOSS_DAMAGE } from '../howToPlay.js';

const cards = howToPlayCards();
const text = (id) => cards.find((c) => c.id === id).body;

assert.equal(cards.length, 6, 'six cards, one idea each');
assert.equal(new Set(cards.map((c) => c.id)).size, 6);

assert.match(text('front-office'), new RegExp(`${MAX_ROUNDS} rounds, ${START_HP} HP`));
assert.match(text('front-office'), new RegExp(`lose ${LOSS_DAMAGE} HP`));
assert.match(text('shop'), new RegExp(`^${SHOP_SIZE} free agents`));
assert.match(text('shop'), new RegExp(`Reroll for ${REROLL_COST} gold`));
assert.match(text('shop'), new RegExp(`holds ${BENCH_CAP}`));
assert.match(text('gold'), new RegExp(`start with ${STARTING_GOLD}`));
assert.match(text('gold'), new RegExp(`pays ${BASE_INCOME}`));
assert.match(text('gold'), new RegExp(`up to ${INTEREST_CAP}`));
assert.match(text('court'), new RegExp(`play ${teamSizeCap(1)} at the start and ${teamSizeCap(MAX_ROUNDS)}`));
assert.match(text('stack'), new RegExp(`×${STAR_MULTIPLIER}`));
for (const s of [...schemes.offenses, ...schemes.coverages]) assert.ok(text('call').includes(s.name), s.name);

assert.ok(PITCH.line.length < 80, 'the pitch is one breath');
assert.equal(PITCH.why.length, 3);

// Every tour stop points at a data-tour attribute that exists in a template.
const here = dirname(fileURLToPath(import.meta.url));
const templates = ['../../App.vue', '../../components/PlanningPhase.vue']
  .map((p) => readFileSync(join(here, p), 'utf8')).join('\n');
for (const stop of CONTROLS_TOUR) {
  assert.ok(templates.includes(`data-tour="${stop.target}"`), `tour target ${stop.target} exists`);
}

console.log(`howToPlay: ${cards.length} cards and ${CONTROLS_TOUR.length} tour stops match the rules`);
