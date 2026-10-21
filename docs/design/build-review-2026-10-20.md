# Build Review — Game Design & Art Direction

*Hardwood Autochess, reviewed 2026-10-20 and revised the same day after the merge into `main` (a3ca126). That merge combined the Sept 8 work (PixiJS court, "Front Office 101" tutorial, roster additions) with the sim overhaul from `fix/hardwood-embed-fit` and shared-core 51ea3c7. Method: headless playthroughs at 1280px and 390px with screenshots of every phase, plus engine probes driving the real WASM build in Node. Companion to `fun-brief.md`, `tactics-design.md` and `2026-09-08-tutorial-adaptive-skill-arc-design.md`.*

---

## Verdict

The design thinking is ahead of the build. The fun brief and tactics doc describe a game with a rare hook: the winning patterns are real basketball's winning patterns. Until today the simulation couldn't deliver it. **Rounds were decided by accident:** most ended 0-0, a draw counted as a loss, and a planning board that misrepresented the court fed the sim. Everything above the sim was teaching lessons the sim never acted out: scheme grades, Film Room notes, the tutorial's shot-value glow.

Now rounds score like basketball (7-6, 4-5, 13-14), talent moves the result, and the Pixi court finally *looks* like a basketball game. The gap to a finished MVP is **coherence**. Every screen has to agree with the sim about what matters, and the player has to be able to see why they won.

---

## What was broken, measured, and fixed

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 1 | Tip Off crashed when the WASM engine loaded | `BindingError: Expected null or instance of GameManager…` (a Vue Proxy around the Embind object) | Already fixed on main by 544f33f (`markRaw`). **The live zero-next `/hardwood` bundle predates that fix** |
| 2 | **Rounds didn't score** | 10s 5v5 rounds were 0-0 in 14/20 probes, and 40s games froze | Engine sim overhaul (shared-core 51ea3c7), rows 3–8 |
| 3 | Ball left the court and never came back | Miss velocity sized for a 0.7s flight, but the arc hung ~2.1s. No bounds, no friction | Physically consistent arc, in-bounds landing, dead ball on landing |
| 4 | All five defenders guarded the ball | "Nearest attacker" marking collapsed onto the driver | Man-to-man assignment with help-side sag |
| 5 | No threes, ever | Shots only inside 100px, and "spots" were inside the 200px arc | Five real spots outside the arc, catch-and-shoot when open. ~30% of makes are threes |
| 6 | League-average shooter made half the league rate | `skill = shooting/100` | `0.5 + shooting/100`. FG% went from ~16% to ~48% |
| 7 | Draws decided by fiat | "Draw counts as a loss" | 12s on screen = 30s sim, then sudden-death OT |
| 8 | Free home edge | Home always had the opening possession: 61% mirror win rate | Jump ball. Mirror ~50% once ties are excluded |
| 9 | Box score credited the wrong team | "Player 901 — 2 PTS" | Engine exports `lastScorerId` |
| 10 | Planning board misrepresented space | Board drawn as a half court (hoop at bottom) but engine read it transposed from the backcourt | `PlanningToCourt` maps it as drawn; floor spots assigned by placement |
| 11 | Main's court ignored the opponent and tactics | Pixi `CourtCanvas` didn't declare the `opponentUnits`/multiplier props App passes. Its inline fallback fought three hardcoded bots | Props restored; `fallbackSim.js` is the backup ref again |
| 12 | Planning-phase engine calls got a ref, not the engine | App `provide`s the engine **ref**; children used it unwrapped | `unref` in `getEngine` |
| 13 | **Bench heroes could never fire in game** | Roster tags Caruso/McCain `role: "bench_hero"`, but only `LoadRosterJSON` read it, and the client spawns through `SpawnUnit` | `SetBenchHero` binding + ghost-board `role` fields, looked up by `rosterId`; schema declares `role`/`ppg_mean`/`ppg_stddev` |
| 14 | Tutorial's coverage card covered the scoreboard all fight | It only cleared on a coverage *change*; "Start Fight" straight away left it up | Onboarding completes on `fight-started` |

Win-rate sanity after the fixes (300 sims each, 30s plus OT): top-cost five vs bottom-cost five **86%**; random mirror **56%** (post-OT ties counted as home losses).

---

## Game design analysis

### Core loop: shop → board → scheme → scout → sim → read

**Strong:** the decision stack is the right shape for an autobattler and more distinctive than most. Who (shop), where (board), what we run (offense), what we're in (coverage), and a scouting step that turns matchmaking luck into information. The scouting screen ("Coach's Board — coverage reads") is still the best screen in the game. It's specific, named, and it suggests without auto-playing.

**Weak, in priority order:**

1. **The coverage decision is asked twice, and the second one is fake.** Scouting asks "Your coverage call" from tactics.js's five schemes; that call feeds `resolveMatchup` and changes the sim. Then the Pixi pre-fight panel asks again: Drop/Switch/Blitz/ICE/**Zone** (a different list from scouting's "2-3 Zone"), labeled *"preview only — the ref doesn't enforce it yet,"* not synced to the first answer. A player who changes their mind at the second picker gets nothing. **Recommendation:** delete the scouting picker and make the pre-fight panel the real one. Its shot-zone glow is the better teaching surface. Have it write `myCoverage` and resolve the matchup on Start Fight.
2. **The tutorial teaches a shot map the sim doesn't use.** Act 2 says the glow is shot value: "the rim and the corners are bright… the mid-range is the worst shot." The engine has no corner advantage (every spot is the same three), and placement barely changes win rate (spread vs clumped ≈ even). **Recommendation: spot roles.** The *corner* gets a shorter three (the NBA corner is 22ft vs 23.75ft, a real eFG edge), the *dunker spot* gets offensive-rebound priority, and the *top* gets handler/pass priority. About 30 lines in `Court.cpp`, and the tutorial's lesson becomes true.
3. **The read grade contradicts the scoreboard.** A headline **D** on a 7-6 *Victory*, then the same story again in the Film Room. **Recommendation:** label it "Scheme read: D", cap the lesson at two sentences, and move the counter-play onto the next planning screen, where the player can act on it.
4. **Fixed −20 HP.** Fun-brief rec 6 (margin damage) is still open; `App.vue` hardcodes "-20 HP". With real scores there's finally a signal: lose 13-14 → −8, lose 2-12 → −20.
5. **Franchise synergies are thin.** 29 players across 14 franchises, 6 with a single player. OKC (5) is now the only deep stack. **Recommendation:** 3+ per franchise for 8 franchises, or lead with archetype synergies anyone can reach.
6. **2-star = ×1.8 stats** is a cliff that also clamps at 99, so a star-up's real value depends on the base stat and players can't see it. Prefer ×1.35 plus a visible star ring in the sim.

### Learning: is the game a teacher?

Main's "Front Office 101" tutorial is a big step forward. It guides without gating, gives each act a transferable "real-world skill" tag, and remembers completion. Two problems remain:

- **It covers what it teaches.** The Act 1 card sits over the offense/coverage pickers and synergy bar. At pre-fight, two "COACH MILLER" voices are on screen at once (the overlay and the coverage panel). One voice, docked beside the action, never on top of it.
- **It's still text-first.** Three paragraphs across three acts, where George Fan's rule is visuals over words. The placement glow is the right instinct; make it carry the lesson and cut the copy to one line per act.

### Feedback: game feel

The Pixi court adds wood texture, unit shadows and a shot-clock ring, which is real atmosphere. Still open:

- **No sound at all.** Swink's sub-100ms acknowledgment is half audio. A swish, a rim clank, a crowd swell on an OT winner, and a register "ka-ching" on buys are the cheapest juice left.
- **Juice was lost in the Pixi move.** The canvas court's `feel.js` effects (rim ripples, net flick, backboard shudder, screenshake hierarchy) aren't wired into `CourtRenderer.js`. Port the made-basket hierarchy first: 3PT > 2PT, with the only shake reserved for the OT winner.
- **The result arrives as a wall** after a flat 1.5s, whatever the final play was.

---

## Art direction analysis

**Current identity:** a dark slate UI around a warm, textured Pixi hardwood court, TFT-style cost-tier colors on premium draft cards, Bootstrap-danger red (#d9534f) as the primary action color, and system fonts. The court and cards now carry a look; the chrome around them doesn't.

| Area | Observation | Direction |
|---|---|---|
| **Typography** | No display face. Title, stats and prose all use system sans (`'Segoe UI', Tahoma…`, so Verdana-ish on Mac) | One condensed athletic display face (scoreboard/jersey feel) for headings, numbers and the clock. Tabular numerals wherever numbers change |
| **Units** | Identical red/blue discs with 3-letter truncations ("Alv", "Car"), now with drop shadows. Unreadable at phone width | Jersey-style tokens: team-color fill, number, last name on hover/selection. Show the ★★ ring in the sim |
| **Sim court at 390px** | The 2:1 court scales to ~370×185 with half the viewport empty | On portrait phones, rotate the sim vertical, matching the planning board's orientation |
| **Planning ↔ sim continuity** | Planning is a vertical half court; sim is a horizontal full court. After today's fix they agree on *where* players are, but still show it two ways | Animate tip-off as a camera pull-back from the planning half court into the full court |
| **Tip-off glyph** | `&#127925;` renders 🎵 (musical note) as the "whistle" | SVG whistle, or just the ring animation |
| **Color semantics** | Red means "you" (home tokens, score) and also destructive actions (Sell, Lock In). Gold means currency and the timer | Give home its own hue (warm orange), keep red for destructive, gold for currency only |
| **Overlay stacking** | Coach card, coverage panel and scoreboard compete for the top of the screen | One persistent coach rail (side on desktop, bottom sheet on phone); the scoreboard is never covered |
| **Result screen** | Four stacked text panels in one card | Lead with one image: the score, a mini shot chart (the data is captured), and the most decisive play. Text goes behind a "Film Room" expander |

---

## Finish line: definition and order

**MVP = a stranger can finish a 10-round run on a phone, understand why they won or lost each round, and want to share the result.** Ordered by ROI:

1. **Ship to zero-next.** The live `/hardwood` bundle predates both the Tip Off fix and the sim overhaul. Rebuild with `npm run build:hardwood`, copy, update `SOURCE_COMMIT.txt`.
2. **One real coverage picker** (pre-fight panel, enforced) and **spot roles**, so both the tutorial's lessons become true.
3. **Coach rail**: tutorial guidance that never covers controls or the scoreboard.
4. **Result screen redesign**: score, mini shot chart, one decisive play, "Scheme read" label, margin-scaled HP.
5. **Port `feel.js` juice into the Pixi renderer, plus a four-sound pass.**
6. **Portrait sim + jersey tokens** at phone width.
7. **Roster depth per franchise.**
8. **Run recap card** (fun-brief rec 12), the share artifact.

### Data and ops notes

- **Bench heroes in production:** zero-next serves the roster DB-first (`bball_roster`, regenerated daily from real NBA data). That table has no `role`/`ppg_*` columns, so live rosters carry no bench heroes until `generateRoster.ts` assigns them. Today's wiring works with the static fallback roster.
- zero-next's static `public/engine_roster.json` was 6 players and the bench-hero tags behind this repo's. Synced on zero-next `chore/sync-hardwood-roster`.
- The **Basketball Modeling** routine (source of the F-numbered findings) has been disabled since early June. Its ledger's BballTactics items #17/#18 shipped in shared-core c01b2d1. #5 (injury flag) has schema fields, and the shop filters `is_active`.
- `SynergyEngine.cpp` computes `lockdownCount` and never uses it (compiler warning). A defensive "Lockdown" synergy looks planned but unwired, which is a cheap win for item 7.
