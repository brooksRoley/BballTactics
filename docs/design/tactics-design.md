# Tactics Design — Schemes, Coverages, and the Three-Lens Mastery Model

*Hardwood Autochess mechanics layer, 2026-07-09. Companion to `docs/design/fun-brief.md`. Deliverables: `client/game/schemes.json` (data spine), `client/game/tactics.js` (pure resolution engine), `client/game/__tests__/tactics.test.js` (23 tests, `node client/game/__tests__/tactics.test.js`). New files only; nothing existing was touched.*

**Sourcing note (honest):** Cleaning the Glass's play-type numbers live behind its subscription; this doc uses CTG's public stats pages — which describe its shot-location categories, halfcourt/transition context splits, garbage-time filtering, and percentile framing ([cleaningtheglass.com/stats](https://cleaningtheglass.com/stats/)) — plus reputable secondary coverage for the specific coverage trade-offs: [Brew Hoop's Bucks dictionary on Drop](https://www.brewhoop.com/2019/8/13/20801779/milwaukee-bucks-dictionary-drop-pick-and-roll-defense), [Slappin' Glass on drop-and-pop](https://www.slappinglass.com/2026/01/18/defending_the_pop_drop_coverage/), [The Basketball Action Dictionary on PnR coverages](https://medium.com/thebasketballactiondictionary/how-to-identify-pick-and-roll-coverages-a1e8dffe54e9), [The Hoops Geek on beating low drop](https://www.thehoopsgeek.com/basketball-plays/pick-roll-against-low-drop-defense/) and [Zoom action](https://www.thehoopsgeek.com/basketball-zoom-action/), [Hoop Mentality on the Blitz](https://hoopmentality.com/blogs/basketball/blitz-the-pick-and-roll-advanced-defense-explained), and [Hooper University on Spain PnR](https://www.hooperuniversity.com/breakdowns/ball-screen-offense-spain-pnr-explained). Coverage vocabulary is kept deliberately consistent with Brooks's own NBASwiftTactics `PuzzleModel.swift`, which already teaches Drop, ICE/Down, Switch All, and Blitz/Trap with CTG-style explanations.

---

## Why schemes, in one paragraph

The fun brief's thesis is that this game's winning patterns should be *real basketball's* winning patterns (Koster: fun is pattern-learning; here the pattern transfers to watching an actual game). Units and synergies already encode *personnel* truth (spacing math, z-scored stats). Schemes add the second axis every NBA broadcast actually argues about: *what you run and what you're in*. The player now makes three calls per round — who plays, where they stand, what we run, what we're in — and the post-round feedback explains the result in the same vocabulary an NBA coach would use. That is the teaching hook made mechanical.

## The scheme set

Five offenses and five coverages — small enough to learn in a run, real enough to Google. Each entry in `schemes.json` carries: insider `name` + `lingo` aliases, a one-line plain-English `translation` (the lingo teaching hook, shown on first encounter), `personnel` stat interactions against the roster's shooting/speed/defense triad, a full `counters` row (offense × coverage multiplier + a WHY note), and a `citation` string for the post-round breakdown.

| Offense | Translation (lingo hook) |
|---|---|
| **Spread Pick-and-Roll** | One ball screen up top, four shooters holding the arc — give the defense two bad choices. |
| **Spain Pick-and-Roll** | A normal ball screen with an ambush: a shooter back-screens the dropping big, then pops. |
| **Zoom (Chicago)** | A pindown screen flowing straight into a dribble hand-off — the catcher is already moving downhill. |
| **Delay 5-Out** | Your big runs the offense from the top while all five start beyond the arc — every cut has a runway. |
| **Seven Seconds or Less** | Push off every rebound and make — shoot before the defense can call a coverage. (Named to match the engine's existing 7SOL synergy.) |

| Coverage | Translation (lingo hook) |
|---|---|
| **Drop** | Big sinks to the rim on every screen: wall off layups and lobs, live with pull-up jumpers. |
| **ICE (Push/Blue)** | Force the handler down the sideline — the baseline becomes your sixth defender. |
| **Switch Everything** | Trade assignments on every screen: nobody gets open, somebody guards the wrong guy. |
| **Blitz (Trap)** | Two at the star the moment the screen hits: rip the ball out, gamble 4-on-3 behind. |
| **2-3 Zone** | Guard the floor, not the man: pack the paint, dare them to shoot over it. |

## The counter system

Every offense↔coverage pair has a base multiplier in the **0.85–1.15 band** — rock-paper-scissors with teeth, no hard counters, so drafting still matters more than scheme-picking (a maxed scheme edge is worth less than one good unit upgrade). The matrix encodes real empirical trade-offs: Drop concedes pull-ups (Spread 1.12, Spain 1.15 — the back-screen ambush is literally designed for drop bigs) but wins vs rim-pressure and transition (Delay 0.94, 7SOL 0.92 — floor balance); ICE strangles ball-screen offense (Spread 0.90) but has no jurisdiction over hand-offs (Zoom 1.06); Switch kills choreography (Spain 0.88, Zoom 0.90) but writes mismatches (Spread 1.02) and breaks in transition cross-matches (7SOL 1.05); Blitz is the only below-average base column *by design* — its payoff is personnel-conditional (the `starShare` modifier: trapping pays against a one-star board, bleeds against balanced 5-out spacing, Delay 1.12); the 2-3 packs cutting lanes (Delay 0.90, Spain 0.92) but gets bent by spacing and beaten down the floor (Spread 1.08, 7SOL 1.05). On top of the base, `personnel` modifiers (capped ±4–8% each) reward running schemes with the units they actually need — Drop wants a ≥55-defense **paint anchor** on grid columns 0–1 (home defends the left hoop, `Court.cpp` hoops at x=30/770) and is *penalized 6%* without one; Spread wants a fast handler + floor shooting; 7SOL scales with team speed. Final multiplier = base × (1 + offense deltas) × (1 − coverage deltas), clamped 0.80–1.25.

## The three-lens mastery model

The game teaches players to blend the three ways real analysts read the league — each lens has a dedicated surface:

1. **Eye test** — the sim *renders* the coverage working or failing. `resolveMatchup` notes name actual units ("De'Aaron Fox bends the screen…", "Rudy Gobert anchored the paint…"), so the player connects what they saw on `CourtCanvas` to the scheme call. The eye test is trained by making the causal story visible, per the fun brief's "make patterns visible" rule.
2. **Circumstance** — personnel and context change the answer. The same Blitz that erased a Wembanyama-carry board bleeds against a balanced Delay 5-Out; Drop is only a wall if the wall is real. `suggestCoverage(opponentUnits)` is the circumstance tutor: it *ranks* coverages against the scouted board with reasoning, and the player still chooses — learning-by-suggestion, never auto-play (agency stays with the player).
3. **Analytics** — the post-round box score speaks CTG's language: eFG%, shot-location frequency, halfcourt vs transition splits ([CTG stats](https://cleaningtheglass.com/stats/) breaks shot locations "into categories that matter" and estimates halfcourt/transition context). Each scheme's `citation` string renders in the breakdown ("CTG-style read: drop's accepted bill is the pull-up jumper — Brew Hoop/Slappin' Glass"), so reading the recap *is* learning to read basketball analytics.

A balanced read uses all three; `gradeRead` grades exactly that blend (matchup matrix = analytics, suggestion match = circumstance, and the lesson text tells the eye-test story).

## How schemes enter the game loop

- **Planning phase:** alongside unit placement, the player picks one offense and one coverage (two dropdowns/cards from `listSchemes()`; each card shows `translation` on hover — the lingo hook). Ghost scouting (fun-brief rec 4) makes this an informed read: show `suggestCoverage(opponentUnits)` as a collapsible "Coach's suggestion" panel.
- **Resolution:** on lock-in, call `resolveMatchup(myOffense, theirCoverage, myUnits, theirUnits)` and the mirror call for the opponent (ghost boards get a deterministic scheme: e.g. hash of ghost id → scheme pair, or store scheme picks in `board_states` alongside `board_data`). The returned `offenseMultiplier` scales each team's scoring efficiency — in the JS fallback, multiply the per-possession score chance in `CourtCanvas`; with the engine, scale shot probability at the same point the synergy buffs apply (or pre-scale unit shooting passed to `SpawnUnit` by the multiplier as an MVP shim — no C++ change needed).
- **Post-round:** the box score panel (fun-brief rec 3) appends the `notes[]` from both `resolveMatchup` calls plus `gradeRead(playerChoice, opponentBoard)` — grade, lesson, and the `citation` of any scheme involved. This is the Coach's Whiteboard (rec 10) with real vocabulary.

## Mastery progression: seen → used → understood

Every scheme id is a *lingo term* with three mastery states, persisted in localStorage (`tactics_mastery` map: `{ [schemeId]: 'seen' | 'used' | 'understood' }`):

- **Seen** — the term appeared in a matchup note, suggestion, or opponent board. UI: term renders with a dotted underline + translation tooltip. (First encounter always shows the plain-English line — never assume the lingo.)
- **Used** — the player ran it at least once (`playerChoice` contained it). UI: solid badge in the scheme picker.
- **Understood** — the player *correctly countered* it: a `gradeRead` result of B or better where the relevant concept appears in `concepts[]` and the corresponding edge was positive (offense edge for offenses, defense edge for coverages). UI: gold badge + the citation unlocks in a "Playbook" glossary page.

This is Koster's loop made explicit: the pattern is named when seen, embodied when used, and certified when it wins a read. Ten terms × three states is a complete, finishable learning arc for a 10-round run — and "Understood 10/10" is a shareable mastery stat for the run-recap card (rec 12), rewarding mastery, never attendance.

## Wiring notes for the MVP-builder agent (one line each)

1. `import { listSchemes } from '../game/tactics.js'` in the planning UI → render offense + coverage pickers; default `spread_pnr` / `drop`.
2. On lock-in in `App.vue`, call `resolveMatchup(myOffense, theirCoverage, onCourt, opponentBoard.units)` (and the mirrored call) → pass both `offenseMultiplier`s as props into `CourtCanvas.vue`.
3. In the JS-fallback scoring check in `CourtCanvas.vue`, multiply the home/away score probability by the respective `offenseMultiplier`; engine path: scale each unit's `shooting` by the multiplier before `SpawnUnit` as the MVP shim.
4. On the result screen, call `gradeRead({offense, coverage}, {offense: theirOffense, coverage: theirCoverage, units: theirUnits})` → render `grade` big, `lesson` under the box score, and both matchups' `notes[]` as the "Film Room" list.
5. Render `suggestCoverage(opponentBoard.units)` (top 3) in the ghost-scouting panel with each `reasoning` line — display only, never auto-select.
6. Persist/read the `tactics_mastery` localStorage map on those same events (`seen` on render, `used` on lock-in, `understood` on gradeRead B+ with positive edge); `getScheme(id).citation` powers the glossary page.
7. Ghost scheme picks: extend the `board_states` submit payload with `{offense, coverage}` when available; fallback for old ghosts: `offenses[ghostId % 5]` / `coverages[ghostId % 5]` — deterministic, no RNG.
8. `schemes.json` is imported by `tactics.js` with `with { type: 'json' }` (Node 20.10+/Vite both accept it); tests run standalone: `node client/game/__tests__/tactics.test.js`.

## Balance guardrails (for the balance bot, `bots/balance/`)

- Base band 0.85–1.15 and final clamp 0.80–1.25 are asserted by tests; if `simulate.py` sweeps schemes, expect scheme choice to swing win rate by less than one cost-3 unit swap — if it swings more, shrink `perPoint` caps in `schemes.json`, not the matrix.
- Every offense row and coverage column has ≥1 favorable and ≥1 unfavorable matchup (tested), so no dominant strategy exists at the scheme layer by construction.
