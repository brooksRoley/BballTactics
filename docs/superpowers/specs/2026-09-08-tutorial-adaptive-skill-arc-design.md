# Tutorial Redesign — "Front Office 101": an adaptive skill-arc

**Status:** Design, awaiting review.
**Date:** 2026-09-08

## Goal

Replace the current rigid 4-step tutorial (`TutorialPhase1.vue`) with an **adaptive, guide-don't-gate coach overlay** that rides on the *real* game screens and, across three acts, teaches the game while explicitly framing each mechanic as a transferable real-world skill.

Design decisions already locked (with the owner):
- **Ambition:** full redesign into an adaptive skill-arc.
- **Skill lens:** weave all three (draft → placement → coverage), building an arc.
- **Integration:** full fold-in — remove the separate mock `TutorialPhase1`; coaching drives on the real draft/court/coverage screens.
- **Guidance:** guide, don't gate — never block or scold; Coach reacts and teaches, choices are always allowed.

## Problems with today's tutorial (from review)

- **Not fun:** a single-correct-click gate that scolds exploration ("I said draft Caruso, rookie").
- **Not intuitive:** a separate mock UI (own shop/economy, no court) that then hands off to a different-looking real planning screen which re-explains the same things.
- **Wastes the real-world-skills hook:** only gestures at salary tiers; never frames resource allocation, expected-value thinking, or strategic adaptation.
- **Not adaptive:** one fixed path, identical every run; re-runs every visit (no persistence).

## Architecture

Two new units + wiring into the existing real screens; delete the mock.

### New: `client/composables/useTutorial.js`
The onboarding state machine and single source of truth. Pure-ish, presentation-layer (no engine coupling).

State (reactive):
- `active` — whether onboarding is running (true for new players, false once `bball_onboarded` is set).
- `act` — `'draft' | 'placement' | 'coverage' | 'done'`.
- `message` — current Coach Miller line.
- `skillTag` — current "🎓 Real-world skill: …" line (or null).
- `spotlight` — optional CSS selector / key for the element to highlight.

API:
- `maybeStart()` — activate only if `localStorage['bball_onboarded']` is unset.
- `skip()` / `complete()` — set `bball_onboarded`, deactivate.
- `replay()` — clear the flag and restart from Act 1.
- Event hooks the real screens call:
  - `onPlayerBought(player, { goldLeft, rosterCount })`
  - `onPlayerPlaced({ onCourtCount, zoneWarmth })`
  - `onCoverageOpened()` / `onCoverageSelected(scheme)`
- `next()` — manual advance for a "Next" button on informational beats.

Adaptive reactions are **pure functions** `(event, gameState) -> { message, skillTag? }`, unit-reasonable and easy to tweak. Examples:
- Act 1 open: "That 10G is your salary **cap** — a hard limit. Every signing spends it; spending here means not spending there. That's opportunity cost." 🎓 *budgeting / opportunity cost.*
- Bought a 5-cost leaving little gold / tiny roster → "A superstar eats your cap. Titles need a rotation, not one hero — balance stars with role players."
- Reached a fieldable roster → advance to placement.
- Act 2 open (court visible): "Where a player stands sets the shots they take. The glow is shot value — bright = efficient (rim, corner 3), dim = a long two, the worst shot in basketball." 🎓 *expected-value thinking.*
- Placed in a cold zone → "That's a cold spot — slide them to the corner or the paint."
- Reached 3 on court → advance to coverage.
- Act 3 open (prefight): "Call your coverage. There's no single right answer — take away what THEY do best, then adapt." 🎓 *strategic adaptation / game theory.*
- Coverage selected → "Good read. Coverage is rock-paper-scissors — the best defense depends on the offense." → `complete()`.

### New: `client/components/CoachOverlay.vue`
Presentational only; renders when `useTutorial.active`. Shows the Coach Miller bubble (message + skill tag), a **Next** control on informational beats, and a persistent **Skip tutorial** control. Optionally dims the screen and spotlights `spotlight`. Reuses the existing Coach Miller visual language (`#d9534f` accent, hardwood border).

### Modified: `client/App.vue`
- Remove the `phase === 'tutorial'` branch and the `TutorialPhase1` import; start at `phase = 'planning'` for round 1.
- Instantiate `useTutorial`, call `maybeStart()` after roster load, render `<CoachOverlay>`.
- `buyPlayer` fires `onPlayerBought`.
- Returning players: `maybeStart()` no-ops (flag set); add a small "Replay tutorial" affordance (e.g., a tiny link in the round-1 planning header) calling `replay()`.
- The old dismissible `planning-intro` bubble is subsumed by Act 1/2 and removed (its content becomes adaptive coach copy).

### Modified: `client/components/PlanningPhase.vue`
Emit/callback on placement so App can call `tutorial.onPlayerPlaced(...)` with on-court count + the placed cell's zone warmth (via existing `useZoneEfficiency`).

### Modified: `client/components/CourtCanvas.vue`
Emit on prefight coverage shown + on scheme selected so App can call `tutorial.onCoverageOpened/Selected`.

### Removed: `client/components/TutorialPhase1.vue`

## Data flow

```
new player → App.maybeStart() → tutorial.active, act='draft'
  draft shop buy → onPlayerBought → adaptive coach line → (roster ready) act='placement'
  court placement → onPlayerPlaced → adaptive coach line → (3 on court) act='coverage'
  Lock In → prefight → onCoverageOpened → coach line
  scheme select → onCoverageSelected → complete() → bball_onboarded=true, active=false
returning player → maybeStart() no-op → normal game; "Replay tutorial" available
```

## Error / edge handling
- No `localStorage` (private mode): tutorial still runs in-memory; completion just isn't remembered (acceptable).
- Skip at any time → `complete()`; never trap the player.
- Guide-don't-gate: acts advance on natural progress; if the player does something "suboptimal," Coach comments but never blocks.

## Non-goals
- No changes to the C++/WASM engine, sim, or economy math.
- No new art beyond reusing the existing Coach Miller bubble styling.
- Film Room, synergy preview, and zone overlay behavior are unchanged (the tutorial only *references* the zone overlay).

## Verification
BballTactics has no JS test framework (C++ tests only), so verification is build + Playwright drive:
- New player: full three-act arc fires with correct skill tags; completes; `bball_onboarded` set.
- Returning player (flag set): no tutorial; "Replay tutorial" restarts it.
- Skip works at each act.
- Adaptive branches: buying a lone 5-cost and placing in a cold zone each trigger their reaction lines.
Plus the existing full-fight smoke path still works end-to-end.
