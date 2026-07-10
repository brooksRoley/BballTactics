# Fun Brief — Hardwood Autochess

*Research-to-build decisions for maximizing fun, framed as Brooks's definition: **interactive agency + learning + feedback**. Written 2026-07-09 against the current codebase (Vue 3 client, C++/WASM engine, FastAPI ghost backend).*

---

## Three frames

### 1. Agency — meaningful decisions under uncertainty

Autobattler fun lives in the economy, not the combat. TFT's core insight is that board strength and gold are **one feedback loop, not a tradeoff**: interest breakpoints (every 10g, capped +5) and win/loss streak gold turn "roll vs save vs level" into a real decision every round ([TFT econ loop](https://tft.ninja/guides/creators/dpei/econ-loop-explained), [Mobalytics economy strategies](https://mobalytics.gg/blog/tft/how-to-manage-your-economy-in-teamfight-tactics-three-strategies/)). Our economy currently has flat income (`5 + min(round,5)` in `App.vue`) — no breakpoints, no streaks, so there's nothing to *decide*. Second insight: RNG feels fair when it's **input randomness** (a random shop you then make decisions about) rather than **output randomness** (your decision succeeding or failing on a roll), and when the player can see the odds ([Game Developer: Randomness and Game Design](https://www.gamedeveloper.com/design/randomness-and-game-design), [BGG input/output thread](https://boardgamegeek.com/thread/1294990/input-vs-output-randomness)). Riot layers explicit [bad-luck protection](https://dotesports.com/league-of-legends/news/riot-says-theres-bad-luck-protection-for-item-drops-in-teamfight-tactics) on top so variance never feels like punishment. Our shot resolution is output randomness — that's fine (it's basketball), but everything upstream (shop, odds, income) should be visible, deterministic input randomness.

### 2. Learning — the game as teacher

Koster's *[Theory of Fun](https://www.theoryoffun.com/)*: fun **is** learning — brains eat patterns, and a game dies when the pattern is either mastered or unidentifiable ([summary](https://www.shortform.com/blog/a-theory-of-fun-for-game-design/), [Lost Garden review](https://lostgarden.com/2005/05/08/book-raph-kosters-theory-of-fun-for-game-design/)). Two build consequences: (a) the difficulty curve must stay in the flow channel — ghost opponents should scale with the player's demonstrated skill, which our ELO + `board_states` backend can already do; (b) the game must make its patterns *visible*, or there's nothing to learn. TFT added a per-round combat damage recap precisely to answer "why did I lose" ([TFT damage recap](https://tft.ninja/guides/game-mechanics/player-damage-calculation)); we have richer data than TFT (every shot, contest, position) sitting unused in `GetGameStateJSON()`. For onboarding, George Fan's PvZ rules apply directly: blend the tutorial into play, teach one mechanic at a time in a controlled sandbox, use visuals over words ([GDC: 10 tutorial tips](https://www.gamedeveloper.com/design/gdc-2012-10-tutorial-tips-from-i-plants-vs-zombies-i-creator-george-fan), [talk](https://www.gdcvault.com/play/1015541/How-I-Got-My-Mom)). Coach Miller is the right frame; extend him across rounds 1–3, not one screen.

### 3. Feedback — game feel and honest reward

Swink defines game feel as *real-time control of virtual objects in a simulated space, with interactions emphasized by polish* — and pins "real-time" at **<100ms response** to any input ([Game Feel](https://en.wikipedia.org/wiki/Game_feel), [ch. 1](http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf)). Jonasson & Purho's ["Juice it or lose it"](https://gamejuice.co.uk/resources/juice-it-or-lose-it) shows the same mechanics feel 10x better with layered particles, tweens, sound, and shake — juice is added *on top of* a working system, never load-bearing. Vlambeer's ["Art of Screenshake"](https://www.youtube.com/playlist?list=PL2gEO25pE6dqsPxgajrZSuqutgzZSjnk5) adds the hierarchy rule: reserve the biggest effects for the rarest events, or everything reads as noise. On rewards: streaks and variable rewards are compelling *because* they exploit the same loops as slot machines — the honest line is rewarding **play quality and mastery** (solve streaks, personal bests, visible skill growth), never **attendance** (login streaks, expiring timers). Brooks's sustainability value: celebrate, don't hook.

---

## Top 12 recommendations

| # | Recommendation | Frame | Milestone | Effort | Implementation in this codebase |
|---|---|---|---|---|---|
| 1 | **Interest + streak gold** — +1g per 10 saved (cap 5), +1/2/3 streak bonus at 2/4/6 W or L | Agency | M1 | S | Replace the flat `gold.value += 5 + Math.min(round.value, 5)` in `App.vue` with breakpoint math; show "next round: +Xg" projection in the gold badge tooltip. |
| 2 | **Publish shop odds** — show the tier weights per round right in the shop UI | Agency | M1 | S | The weighted-tier table already exists in `App.vue`'s shop randomizer; render it as "Rd 4: 55/30/15%" next to the reroll button. Visible odds = fair-feeling RNG. |
| 3 | **Post-round box score** — per-player PTS, FG%, open vs contested, +/- | Learning | M1 | M | Accumulate shot events from `GetGameStateJSON()` each sim tick in `CourtCanvas.vue` (or add an event log to `GameManager`'s JSON export); render a table on the result screen. This is the "why did I lose" surface — highest learning ROI in the game. |
| 4 | **Ghost scouting** — preview next opponent's board during planning | Agency | M2 | M | `useMatchmaking.js` already fetches ghost `board_states` from FastAPI; surface the opponent lineup + traits as a collapsible panel in `PlanningPhase.vue`. Converts output RNG (who you face) into input RNG (info you plan around). |
| 5 | **Reroll pity timer** — after 4 rerolls with zero units at your highest affordable tier, guarantee one | Agency | M2 | S | Track a counter beside the reroll handler in `App.vue`; reset on hit. Mirrors TFT's bad-luck protection — variance without despair. |
| 6 | **Margin-scaled HP damage** — lose by 2, take −8; blowout, take −20 | Agency + Feedback | M1 | S | Replace the flat −20 in `App.vue`'s result handler with a function of final score differential from the sim state. Close losses stay hopeful; every point in garbage time suddenly matters. |
| 7 | **Coach Miller across rounds 1–3** — one new mechanic per round (shop → synergies → positioning), taught by doing | Learning | M1 | M | Extend `TutorialPhase1.vue`'s script: round 1 locks all but the buy action, round 2 requires completing a Splash Family pair, round 3 introduces drag repositioning against a scripted weak ghost. PvZ rule: no wall of text, gate the action instead. |
| 8 | **ELO-banded ghost selection** — serve ghosts from ±150 ELO, widening on demand | Learning | M2 | S | In `server.py`'s matchmaking query, filter `board_states` by the run owner's ELO band; fall back to bot boards when the pool is thin. This is the flow channel implemented in one WHERE clause. |
| 9 | **Analytics-grounded trait tooltips** — every synergy explains its real-NBA math | Learning | M3 | S | Add a `why` string per synergy (source it next to `SynergyEngine.h` definitions): e.g. Splash Family → "36% from three = 54% eFG — why real teams space the floor." One sentence, rendered in planning-phase trait badges. |
| 10 | **Coach's Whiteboard post-loss hint** — one actionable line derived from the box score | Learning + Feedback | M2 | M | Rule-based, no LLM needed: if contested-shot rate > 60% → "Your shooters had no space — spread the grid"; if opponent fast-break points high → "Their speed beat you in transition — add defense." Computed from the same accumulated sim events as rec 3. |
| 11 | **Juice pass on CourtCanvas** — event-driven particles/shake/score-pops with an effect hierarchy | Feedback | M1 | M | Feed the parallel visuals agent a typed event stream (`shot_made`, `shot_missed`, `steal`, `buzzer`) diffed from `GetGameStateJSON()` between rAF frames, instead of letting it poll raw state. Hierarchy: 3PT > 2PT, game-winner gets the only screenshake. |
| 12 | **Shareable run recap card** — final comp, traits, W/L sparkline, "signature play" stat | Feedback | Post-MVP | M | Render a canvas/OG-image card from the run summary already tracked in `App.vue`; add a copy-link + tip-jar (`brooksroley.com/funding`) footer. This is the audience-funnel artifact — every proud run markets the game. |

Ship order within M1: 1 → 2 → 6 (three small `App.vue` diffs that create the decision layer) → 3 → 11 → 7.

---

## The NBA analytics teaching hook

The signature move: **the game's winning strategies are winning because real basketball works that way.** Most autobattlers teach patterns that only exist inside themselves; Hardwood Autochess can teach patterns the player re-encounters watching an actual Lakers game — Koster's pattern-learning loop, but the pattern is *real*.

The engine already encodes the real math. `ShotProbability` is contest-aware; `GameEconomy` uses z-scored real stats; Splash Family is literally the spacing thesis. Make the pedagogy explicit in three layers: (1) **trait tooltips** state the analytic principle in one line (rec 9) — a made three is worth 1.5 twos, so 36% three-point shooting equals 54% effective FG%; (2) the **box score** (rec 3) uses real notation — PTS, eFG%, contested% — so reading it *is* learning to read basketball analytics; (3) a post-MVP **"Film Room"** mode replays a round with annotations ("this cut worked because the corner shooter dragged the help defender").

For Brooks's Lakers Basketball Data Strategy target, this is the portfolio sentence that no CRUD app produces: *"I built a game where players learn spacing math by playing it — here's the sim, the data pipeline, and the retention numbers."* The teaching hook isn't a feature; it's the demo.

---

## Game-feel checklist

For the visuals agent working in `CourtCanvas.vue` / `PlanningPhase.vue` — each item is verifiable:

- [ ] Every gold spend (buy, reroll, sell) has sound-or-motion acknowledgment within **100ms** of the click (Swink's real-time threshold).
- [ ] Gold and HP changes animate as counting transitions (~300ms), never instant number swaps.
- [ ] Reroll deals new shop cards in with a staggered animation, total under 400ms, skippable by clicking.
- [ ] Dragging a player lifts it (scale ≥1.05 + shadow) on grab; drop snaps to the grid cell with an ease-out ≤200ms; invalid drops animate return, never teleport.
- [ ] A synergy activating during planning flashes its trait badge within 100ms of the qualifying placement — before lock-in, so the player learns the threshold by seeing it.
- [ ] Made baskets show ball-through-net motion + a score pop; a 3PT effect is visibly bigger than a 2PT effect (effect hierarchy).
- [ ] Screenshake appears **only** on dunks and round-deciding buzzer plays, ≤150ms and ≤4px amplitude — if everything shakes, nothing does.
- [ ] Round result (W/L banner) appears only after the final play's animation resolves — no premature reveal killing the buzzer-beater moment.
- [ ] rAF loop holds 60fps (frame budget <16ms) with 10 players + max particles on a mid-range phone; degrade particle count, never simulation, under load.
- [ ] Every clickable element has hover/active states and a disabled style; zero dead-feeling clicks anywhere in shop or planning.

---

## Anti-patterns to avoid

- **Pay-to-win, ever.** The premium tier stays cosmetic + ranked access (board skins, profile badges, seasonal ladder). The moment gold or roster power is purchasable, the ranked tier's integrity — and the portfolio story — is dead.
- **Attendance mechanics.** No login streaks, expiring rewards, or "come back tomorrow!" pressure. Reward mastery streaks (wins, solve rate), which players earn by playing well, not by showing up anxious.
- **Fake urgency.** No countdown timers on shop offers or artificial "limited" units. The planning phase should feel like a chess clock the player controls, not a slot machine lever.
- **Hidden odds / near-miss theater.** Never animate rerolls to *look* like the player almost got the unit, and never obscure tier odds. Published probabilities (rec 2) are both fairer and more strategic.
- **Grind walls.** All 20 (later: full) roster players available in every run from day one. Depth comes from combinatorics and opponents, not from locking content behind hours — a 10-round run must be a complete, satisfying arc for a first-time player on their lunch break.

---

*~1,700 words. Sources linked inline. Companion docs: engine API in `README.md`; visuals work in progress on `CourtCanvas.vue`.*
