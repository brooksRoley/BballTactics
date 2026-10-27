// Regenerate the Full Court golden replays in client/moba/__tests__/goldens/.
//
//   node scripts/full-court-goldens.mjs           check: replay each golden, report match or drift
//   node scripts/full-court-goldens.mjs --write   re-record every golden with the current rules
//
// Only --write after an intended rules change, and bump RULES_VERSION in
// client/moba/match.js in the same commit (see goldens/README.md).
import { writeFileSync, readFileSync } from 'node:fs';
import { createMatch, replay, RULES_VERSION } from '../client/moba/match.js';
import { roster, byName, driverRng, standInDecide } from '../client/moba/__tests__/helpers.js';

const GOLDENS = [
  { file: 'brunson-2q.json', hero: 'Jalen Brunson', seed: 2026, options: { quarterLength: 20, quarters: 2, tutorial: false } },
  { file: 'gobert-tutorial.json', hero: 'Rudy Gobert', seed: 77, options: { quarterLength: 15, quarters: 1, tutorial: true } },
];
const dir = new URL('../client/moba/__tests__/goldens/', import.meta.url);

function record({ hero, seed, options }) {
  const mt = createMatch({ roster, humanId: byName(hero).id, seed, ...options });
  const rng = driverRng(seed * 31 + 1);
  for (let f = 0; f < 60 * 60 * 10 && mt._m.phase !== 'final'; f++) {
    if (f % 15 === 0) {
      const c = standInDecide(mt, rng);
      if (c) mt.command(c);
    }
    mt.step(1 / 60);
  }
  return { ...mt.record(), hero, checkpoints: [...mt._m.checkpoints] };
}

const write = process.argv.includes('--write');
let drift = 0;
for (const g of GOLDENS) {
  const url = new URL(g.file, dir);
  if (write) {
    const rec = record(g);
    writeFileSync(url, `${JSON.stringify(rec)}\n`);
    console.log(`wrote ${g.file}: rules v${RULES_VERSION}, ${rec.log.length} commands, ${rec.ticks} ticks, hash ${rec.hash}`);
    continue;
  }
  const gold = JSON.parse(readFileSync(url, 'utf8'));
  try {
    const r = replay({ roster, ...gold });
    const ok = r.hash === gold.hash;
    if (!ok) drift += 1;
    console.log(`${ok ? 'match' : 'DRIFT'}  ${g.file}: ${r.hash} (golden ${gold.hash})`);
  } catch (e) {
    drift += 1;
    console.log(`ERROR  ${g.file}: ${e.message}`);
  }
}
if (drift) process.exit(1);
