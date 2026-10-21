# Build Review — Game Design & Art Direction

*Hardwood Autochess, reviewed 2026-10-20 against branch `fix/hardwood-embed-fit` (5530b96 → ea649c7) and shared-core `feat/ghost-board-spawn-unit` (51ea3c7). Method: headless playthroughs at 1280px and 390px (tutorial → 3 rounds, screenshots every phase), plus engine probes driving the real WASM build in Node. Companion to `fun-brief.md` and `tactics-design.md`.*

---

## Verdict

The design thinking is ahead of the build. The fun brief and tactics doc describe a game with a rare hook: the winning patterns are real basketball's winning patterns. Underneath, the build could not deliver that hook. **The simulation was deciding rounds by accident:** most rounds ended 0-0, a draw counted as a loss, and (with the WASM engine loaded) the game threw on the first Tip Off. Everything above the sim was teaching lessons the sim never acted out: scheme grades, Film Room notes, synergy chips.

After today's fixes, rounds score like basketball (7-6, 4-7) and talent and tactics move the result. The gap to a finished MVP is now **legibility, not mechanics**. The player has to be able to *see why* they won.

---

## What was broken, measured, and fixed today

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 1 | **Game dies at Tip Off** when the WASM engine loads | `BindingError: Expected null or instance of GameManager, got an instance of GameManager`. `engine` was a deep `ref()`, so Vue proxied the Embind object. Reproduced with the previously shipped engine, so the live `/games/hardwood` very likely has it too | `shallowRef` (a542ee1) |
| 2 | **Rounds didn't score** | 10s 5v5 rounds were 0-0 in 14/20 probes (old engine 9/20), and 40s games froze | Engine sim overhaul (51ea3c7), below |
| 3 | Ball left the court and never came back | Miss velocity sized for a 0.7s flight, but the arc hung ~2.1s. No bounds, no friction | Physically consistent arc, in-bounds landing, dead ball on landing |
| 4 | All five defenders guarded the ball | "Nearest attacker" marking collapsed onto the driver | Man-to-man assignment with help-side sag |
| 5 | No threes, ever | Shots only inside 100px, and "spots" were inside the 200px arc | Five real spots outside the arc, catch-and-shoot when open. ~30% of makes are now threes |
| 6 | League-average shooter made half the league rate | `skill = shooting/100` | `0.5 + shooting/100`. FG% went from ~16% to ~48% |
| 7 | Draws decided by fiat | "Draw counts as a loss" | 12s on screen = 30s sim, then sudden-death OT |
| 8 | Free home edge | Home always had the opening possession: 61% mirror win rate | Jump ball. Mirror is ~50% once ties are excluded |
| 9 | Box score credited the wrong team | "Player 901 — 2 PTS" | Engine exports `lastScorerId` |
| 10 | Duplicate copies vanished in-engine | Two unmerged Carusos shared roster id 4 | Engine ids are lineup slots |
| 11 | Tutorial blocked its own instruction | Coach Miller's box sat on top of the Caruso card | Dialog docks above the shop; other cards dim |
| 12 | Planning board lied about space | Board drawn as a half court (hoop at bottom) but engine read it transposed from the backcourt | `PlanningToCourt` maps it as drawn; spots assigned by placement |

Win-rate sanity after fixes (300 sims each, 30s plus OT): top-cost five vs bottom-cost five **86%**; random mirror **56%** (post-OT ties counted as home losses).

---

## Game design analysis

### Core loop: shop → board → scheme → sim → read

**Strong:** the decision stack is the right shape for an autobattler and more distinctive than most. Who (shop), where (board), what we run (offense), what we're in (coverage), and a scouting step that turns matchmaking luck into information. The scouting screen ("Coach's Board — coverage reads") is the best screen in the game. It's specific, named, and it suggests without auto-playing.

**Weak, in priority order:**

1. **Placement still barely matters.** With spots assigned by placement, the board now picks *who plays where*, but spread vs clumped boards win about equally (59% vs 67%, inside noise). Spots are mechanically identical. **Recommendation:** give spots roles that real basketball has. *Corner* gets a shorter three (the NBA corner three is 22ft vs 23.75ft, a real +eFG edge). *Dunker spot* (baseline, inside) gets offensive-rebound priority. *Top* gets handler/pass priority. One line of engine logic per spot, and the board becomes the spacing lesson the fun brief promises.
2. **Franchise synergies are nearly dead content.** 23 players across 14 franchises; 9 franchises have exactly one player. The planning UI's only synergy hint says to "stack teammates from the same NBA franchise." **Recommendation:** grow the roster to ~40 with 3+ per franchise for 8 franchises, or lead with archetype synergies (Splash Family, Twin Towers, 7SOL), which any roster can reach.
3. **The read grade contradicts the scoreboard.** A **D** on a 7-6 *Victory*, followed by ten lines of text that the Film Room then repeats. The grade measures the scheme matchup, not the result, and that's a fine concept. But a headline "D" on a win reads as a bug. **Recommendation:** label it "Scheme read: D", cap the lesson at two sentences, and move the counter-play ("the book answer is Zoom") onto the next planning screen, where the player can act on it.
4. **Fixed -20 HP.** Fun-brief rec 6 (margin-scaled damage) is still open, and the result screen hardcodes "-20 HP." Now that scores are real, margin damage finally has a signal: lose 6-7 → -8, lose 2-12 → -20.
5. **2-star = ×1.8 stats** is a cliff. It also clamps at 99, so the upgrade's real value depends on the base stat, and players can't see that. Prefer ×1.35 plus a visible star ring in the sim.
6. **Round 1 is 3v2 against the offline squad**, a near-guaranteed win that teaches nothing. Lock round 1 to equal counts.

### Learning: is the game a teacher?

The *content* is excellent: coverage vocabulary, CTG framing, real counters. The *delivery* is text-first, the opposite of George Fan's rule the fun brief cites. The tutorial is three paragraphs and one forced click, then a fourth paragraph on the planning screen.

The tutorial also contradicts the game: it sells Caruso at 1G ("veteran minimum," "Bulls"), and the real shop prices him at 3G on OKC. It features Udonis Haslem (retired 2023) and PJ Tucker (not in the roster). **The teaching hook dies the moment the teacher's facts don't match the board.** Generate the tutorial shop from `engine_roster.json`.

### Feedback: game feel

Good bones: `feel.js` centralizes every tunable, with springs on drag, squash on land, rim ripples, net flick, and a ball trail. Today's change puts screenshake on the fun brief's hierarchy (game-winner > three > two; no shake on passes or misses; 4px max). Still open:

- **No sound at all.** Swink's sub-100ms acknowledgment is half audio. A swish, a rim clank, a crowd swell on an OT winner, and a register "ka-ching" on buys are the cheapest juice left.
- **The result arrives as a wall.** The fun brief asks the W/L banner to land only after the final play resolves. Today it lands after a flat 1.5s, whatever happened.

---

## Art direction analysis

**Current identity:** dark slate UI, warm radial hardwood floor, Bootstrap-danger red (#d9534f) as the primary action color, TFT's gray/green/blue/purple/gold cost tiers, and system fonts (Segoe/Tahoma fallbacks, so Verdana-ish on Mac). Competent, but generic. Nothing on screen says *basketball* except the court lines.

| Area | Observation | Direction |
|---|---|---|
| **Typography** | No display face. The title is default bold sans. Stats use the same face as prose | One condensed athletic display face (scoreboard/jersey feel) for headings, numbers and the clock, with a neutral text face for prose. Tabular numerals everywhere numbers change |
| **Units** | Identical red/blue discs with 3-letter truncations ("Her", "Cla"). On phone the sim tokens are ~10px and unreadable | Jersey-style tokens: team-color fill, number, last name on hover/selection. Size tokens to the canvas, not fixed px. Show the ★★ ring in the sim, not just planning |
| **Sim court at 390px** | The 2:1 canvas scales to 370×185 with half the viewport empty below | On portrait phones, rotate the sim to vertical (hoops top/bottom), the same orientation as the planning board. That also unifies the two views' mental model |
| **Planning ↔ sim continuity** | Planning is a vertical half court; sim is a horizontal full court. Same space, two pictures | Keep planning vertical (it reads well) and animate the tip-off as a camera pull-back from the planning half court into the full court. This is the strongest "aha" available |
| **Tip-off glyph** | `&#127925;` renders 🎵 (musical note) as the "whistle" | Use an SVG whistle, or drop the icon for the ring animation alone |
| **Color semantics** | Red means both "you" (home team, scores) and danger/destructive (Sell, Lock In). Gold means both currency and the timer | Give home its own hue (warm orange), keep red for destructive only, and reserve gold for currency |
| **Tutorial frame** | Overlay dims the whole shop, including the highlighted target. Two gold readouts on screen ("Draft Capital" and header "10G") with different names | Spotlight cut-out on the target. One currency name everywhere ("Cap Space" or "G") |
| **Result screen** | Four stacked text panels in one 640px card | Lead with one image: the final score, a small shot chart (data already captured), and the single most decisive play. Text goes behind a "Film Room" expander |

---

## Finish line: definition and order

**MVP = a stranger can finish a 10-round run on a phone, understand why they won or lost each round, and want to share the result.** Ordered by ROI:

1. **Ship today's fixes to zero-next** (the live embed likely can't pass Tip Off). Rebuild into `dist-hardwood`, copy, and update `SOURCE_COMMIT.txt` with ea649c7.
2. **Spot roles** (corner three, dunker, top): makes placement matter. Engine-only change, about 30 lines.
3. **Tutorial from real roster data**, gated by actions, not paragraphs. Fixes the contradictions.
4. **Result screen redesign**: score, mini shot chart, one decisive play, "Scheme read" label, margin-scaled HP.
5. **Sound pass** (four sounds).
6. **Portrait sim + jersey tokens** at phone width.
7. **Roster to ~40 with franchise depth**, so synergies become real choices.
8. **Run recap card** (fun-brief rec 12), the share artifact.

### Ops notes

- The **Basketball Modeling** routine (source of the F-numbered findings) has been disabled since early June. Its ledger still lists BballTactics items #5, #6, #7, #13, #17, #18. #17/#18 shipped upstream in shared-core c01b2d1. #5 (injury flag) now has `is_active`/`injury_status` in the schema and the shop filters `is_active`.
- `SynergyEngine.cpp` computes `lockdownCount` and never uses it (compiler warning). A defensive "Lockdown" synergy looks planned but unwired, which is a cheap win for item 7.
- The shared-core branch `feat/ghost-board-spawn-unit` is local only. It must be pushed before the submodule pointer in this repo resolves for anyone else. The Pages workflow doesn't check out submodules (the engine ships prebuilt in `public/`), so deploys aren't blocked, but a fresh clone or CMake rebuild is.
