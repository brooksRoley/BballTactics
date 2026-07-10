# MVP Build Log — Hardwood Autochess core loop

Date: 2026-07-09/10 · Agent session (M0 dev-env revival + M1 TFT core loop + sibling integrations)

## How to run it

```bash
# Terminal 1 — backend (zero-next hosts /api/bball/*)
cd ~/Desktop/zero-next && yarn dev            # http://localhost:3000
curl http://localhost:3000/api/bball/setup    # one-time: creates bball_runs + bball_board_states in Neon

# Terminal 2 — game client
cd ~/Desktop/BballTactics && npm run dev      # http://localhost:5173/BballTactics/
```

The client calls the backend at `http://localhost:3000` by default. Override with
`VITE_API_BASE` (e.g. `VITE_API_BASE=https://www.brooksroley.com npm run build` for prod).
Legacy `VITE_API_BASE_URL` is still honored as a fallback. If the backend is
unreachable, the client stays playable: it falls back to a local "Practice Squad"
ghost and local HP bookkeeping, and shows an offline note on the scout screen.

Standalone logic tests (no framework):

```bash
node client/game/__tests__/economy.test.js    # 13 tests
node client/game/__tests__/tactics.test.js    # 23 tests (sibling agent's)
```

## What was built

### M0 — dev environment
- `npm install` was already done (parallel agent); Vite 6.4.1 boots clean, serves
  `/BballTactics/` with the prebuilt-then-rebuilt engine at `public/engine.js|wasm`.
- Backend verified against real Neon: setup, run/start, submit-and-fetch (ghost
  pairing between two runs confirmed), resolve (HP -20/loss, elimination at 0,
  won after round 10, dead-run 400).
- CORS added to all five `/api/bball/*` endpoints in zero-next
  (`src/lib/bballCors.ts` + one guard line per handler) so the :5173 client can
  call :3000 directly. Preflight (OPTIONS 204) and POST verified with curl.

### C++ engine additions (shared-core submodule + Bindings.cpp, WASM rebuilt)
The prebuilt engine had no way to load a ghost opponent — `StartRound()` always
spawned three hardcoded bots (README Phase-10 "known limitation"). Added:
- `GameManager::SpawnUnit(id, name, team, speed, shooting, defense)` — full-stat
  home spawn (team enables franchise synergies, defense finally reaches the sim).
- `GameManager::SetAwayTeamJSON(json)` — parses a ghost board (`units` array or
  bare array, int or string ids, `x/y` or `courtX/courtY`), stores definitions;
  `StartRound()` spawns them as the away team mirrored onto the right half of
  the court. Empty/garbage JSON falls back to the old default bots. Ghost ids
  are always remapped to 901+ to avoid colliding with home unit ids.
- `GetGameStateJSON()` now includes `name` on away players (CourtCanvas already
  renders `bot.name`).
- Rebuilt with Emscripten 5.0.2 (`emcmake cmake .. && emmake make`, clean build
  dir — the shipped CMake cache pointed at an old clone path). Engine grew
  211,313 → 216,078 bytes. All 10 native tests still pass; Node smoke test
  confirms ghost units appear in engine state with correct names/positions.
- App rebuilds the engine roster from scratch every round (RemovePlayer all +
  SpawnUnit), which also sidesteps a pre-existing engine bug where StartRound's
  synergy buffs would compound onto persistent entities across rounds.

### M1 — TFT core loop (client)
New pure-logic modules (unit-tested, no Vue):
- `client/game/economy.js` — shop odds table per round (published in the UI),
  cost-weighted 5-slot shop rolls **with duplicates**, income = 5 base + 1
  interest per 10 banked (cap +5) + streak gold (+1/+2/+3 at 2/4/6 W or L —
  fun-brief rec 1), team-size cap 3→5 by round, full-cost sell-back (2-star
  refunds 3 copies), unit factory with unique per-copy ids, 1.8× star-up capped
  at 99 (engine's clamp), triple detection.
- `client/game/synergies.js` — JS mirror of SynergyEngine trigger rules
  (franchise 2+, Splash Family 3× SHT≥85, 7 Seconds or Less avg SPD>85 & 4+)
  for the planning-phase display.
- `client/composables/useShop.js` — gold/shop/bench state; buy/sell/reroll(2G)/
  income; auto-combine of bench triples into a 2-star (loops until stable).
- `client/composables/useMatchmaking.js` — rewritten for zero-next endpoints
  (`/api/bball/run/start`, `match/submit-and-fetch`, `match/resolve`) with the
  configurable `VITE_API_BASE`.

`client/App.vue` rewritten as the loop orchestrator:
- Round flow: plan → lock-in → submit board (with `{offense, coverage}` in the
  payload) → ghost fetched → **scout screen** (opponent units + top-3
  `suggestCoverage` reads + revisable coverage call) → tip-off → WASM sim vs the
  actual ghost board → result → resolve on server → next round / end screen.
- Server-authoritative HP/round/status with local fallback when offline.
- Economy UI: published tier odds per round, income projection line + gold-badge
  tooltip with the base/interest/streak breakdown, owned-copies badge (n/3) on
  shop cards, combine toast, bench-full notice, streak badge in the header.
- SpringBar (sibling visuals component) replaces the old HP bar.
- Synergy bar with active count + chips during planning.
- Tactics (sibling design): offense/coverage pickers with translations,
  `resolveMatchup` both ways → multipliers baked into shooting stats before
  `SpawnUnit`/`SetAwayTeamJSON`, `gradeRead` grade + lesson and both `notes[]`
  as a "Film Room" on the result screen, `tactics_mastery` localStorage map
  (seen/used/understood), deterministic scheme fallback for old ghost boards
  (`offenses[ghostId % 5]`).
- PlanningPhase stays **mounted** across rounds via `v-show` (court lineup now
  persists — previously it silently vanished every round) and remounts via
  `:key` bump on Play Again.

`client/components/PlanningPhase.vue` — additive-only changes (visuals agent
owns the drag/FX internals): `maxOnCourt` prop (round-based team cap),
`update:court` emit so App can mirror the lineup (synergies/scouting/combine
count), full-cost sell labels, ★★ badges/gold ring for 2-star units.

## Verification (actual output)

- `npx vite build` → `✓ 26 modules transformed … ✓ built in 374ms`
- `node client/game/__tests__/economy.test.js` → `13 tests passed`
- `node client/game/__tests__/tactics.test.js` → `23 passed, 0 failed`
- Native engine tests → `=== All Tests Passed ===` (10 tests)
- WASM Node smoke → ghost units drive the away team: `bots: 901:Jose Alvarado, 902:Patty Mills`
- Integration smoke (tactics → multipliers → WASM sim vs ghost) →
  `home multiplier: 0.948 | away multiplier: 1.076 … sim result: 2 - 0 | away roster: Test`
- API e2e (curl): two runs ghost-paired — run B received run A's board with
  `offense: spread_pnr | coverage: drop`; HP `100→80→…→0, status lost`; dead-run
  resolve rejected with 400.
- CORS preflight from Origin :5173 → `204` with `Access-Control-Allow-Origin: *`.
- zero-next suite after CORS edits: `Test Files 23 passed (23), Tests 345 passed (345)`;
  `eslint src --max-warnings 0` clean.

## Known gaps / honest notes

- **~~JS-fallback sim ignores the ghost board and tactics multipliers~~ —
  closed 2026-07-10.** (Honest correction: the old "internal fallback with
  hardcoded bots" this note described had already been deleted — engine failure
  was a hard stop.) There is now a real backup ref: `client/game/fallbackSim.js`
  is a pure, seeded JS sim that CourtCanvas runs when the engine is missing. It
  uses the actual ghost board (`opponentUnits` prop) and the round's
  `resolveMatchup` multipliers (`homeMultiplier`/`awayMultiplier` props) in its
  shot-probability rolls, and emits the same state shape as
  `GetGameStateJSON()`, so rendering, scoring attribution, and the
  `sim-complete` → `resolveMatch` flow are identical to the WASM path. With the
  engine present (normal case) everything still applies via
  `syncEngineForRound`. Tested headlessly in
  `client/game/__tests__/fallbackSim.test.js`.
- **~~Combines trigger on the bench only~~ — closed 2026-07-10.** Triples now
  merge wherever the copies sit (court, bench, or mixed): `planCombine` in
  `economy.js` finds the cross-zone triple, `useShop.combineTriples` applies it,
  and PlanningPhase exposes `removeUnits`/`placeUnit` (via a template ref in
  App.vue) so the merged 2-star replaces the first on-court copy in its cell —
  otherwise it lands on the bench. The shop's n/3 badge counting was already
  court-aware and stays accurate.
- **In-browser click-through not performed** (no browser automation in this
  environment). Everything below the DOM was exercised headlessly: compile,
  module transforms over the dev server, pure logic tests, the real WASM path,
  and the full API loop. First manual playthrough should watch the console.
- The engine's own synergy analysis runs on top of the JS display — the JS
  panel is display-only (no double-buffing), and franchise synergies now
  actually trigger in-engine because SpawnUnit passes `team`.
- shared-core is a git submodule: the C++ changes live in its working tree and
  need a submodule commit + pointer bump when Brooks reviews.
- `dist/` was refreshed by the verification build; `build/` contains CMake
  artifacts from the WASM rebuild (both were already checked in).
- Stretch items from the tactics brief: (e) mastery localStorage map — done;
  (f) scheme payload on `board_states` — done (round-trips through ghost
  matchmaking, verified via curl).
