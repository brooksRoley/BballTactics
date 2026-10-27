# Game modes on one engine — design note

*2026-10-26. How Hardwood Autochess and Full Court share one engine, which solo, co-op and 5v5 modes
to build on it and in what order, and the tests that decide when each mode is ready to ship.*

## Where we are

Two modes share some layers and not others.

| Layer | Hardwood | Full Court | Shared? |
|---|---|---|---|
| Roster and ratings | `/api/bball/roster`, static fallback | same | yes |
| Rules | C++ `shared-core` in WebAssembly, fully autonomous | JS `client/moba/match.js`, one human-controlled player | **no** |
| Renderer | `CourtRenderer` + figures + `CourtFx` | same, plus `CourtGuides` | yes |
| Meta (gold, shop, rounds) | `economy.js`, 10-round runs | none yet (M1) | no |
| Online | asynchronous ghost boards (`/api/bball/run`, `/match`) | none | no |

Three facts shape the plan:

1. **Full Court already steps on a fixed tick** (`step()` accumulates `dt` into `TICK`), and its
   random numbers come from a seed. A replay therefore needs only the seed and the commands, as long
   as each command records the tick it was given on. Today commands apply when they arrive, between
   ticks, and carry no tick.
2. **JS `Math.sin`, `cos`, `hypot` and similar are not guaranteed bit-identical across browsers.**
   `match.js` uses them 9 times. A replay recorded in Chrome could drift in Safari. WebAssembly
   compiled from the C++ is deterministic across browsers. That is the strongest reason to port the
   rules to `shared-core` (planned for M2).
3. **The server trusts the client.** `/api/bball/match/resolve` accepts `result: "win"` from the
   browser. That is acceptable for a casual ghost ladder, but no ranked or shared leaderboard mode can
   ship on it.

## The structure: one match core, many seat controllers

Every mode is the same match with different **controllers** in the ten seats.

```
MatchSpec {
  mode, rulesVersion, seed,
  clock: { quarters, quarterLength },
  teams: [ { seats: [ { playerId, controller }, ×5 ] }, ×2 ],
  options: { tutorial, rally, items, ... }
}
controller: 'ai' | 'local' | 'remote:<peer>' | 'ghost:<replayId>' | 'board' (Hardwood placement)
```

- **The core** owns only the rules: a fixed tick, a seed, and a command log of
  `{tick, seat, command}`. It knows nothing about who issued a command.
- **Controllers** produce commands. The AI produces them from `view()`. A local human produces them
  from input. A remote human's arrive over the network. A ghost replays a recorded log.
- **One log gives four features.** Replays and a Film Room come from re-running it. Lockstep netcode
  sends only the log entries. Anti-cheat has the server re-run it and compare the final hash. A daily
  challenge is everyone running the same seed.
- **Hardwood fits too:** all ten seats are AI, with a `board` pre-phase that places them. Its
  autonomous WebAssembly sim becomes the first consumer of the ported core.

## The modes

Each column lists the modes in build order. **Bold** modes exist today.

| | Solo | Co-op | 5v5 |
|---|---|---|---|
| 1 | **Hardwood Run** (10 rounds vs ghost boards) | Coach + Player | Captains 1v1 (each human leads 4 AI) |
| 2 | **Full Court Exhibition** | Squad vs AI (2–3 humans) | 2v2 and 3v3, bots fill the empty seats |
| 3 | Daily Challenge (one seed, one scenario, everyone) | Relay (each friend plays a quarter, asynchronous) | Full 5v5, only if players are queuing for it |
| 4 | Season (a ladder of games, shop at quarter breaks, heat) | | Ranked (needs server verification) |

**Solo comes first and carries the product.**
- **Season** turns Full Court's M1 economy into a run with a reason to come back.
- **Daily Challenge** is the cheapest "multiplayer" feeling there is. Everyone plays the same seed,
  for example "down 6, 40 seconds, you're Brunson". Scores are compared asynchronously and checked
  by replaying them on the server. No netcode is needed.

**The first co-op mode is asymmetric: Coach + Player.** One person plays Full Court. The other is the
Hardwood coach: they pick the scheme, call substitutions at quarter breaks and pick the targets for
Fast Break and The Wall. The two existing modes meet in one match, which is the most distinctive idea
on this list. The coach issues a few commands a minute, so a relay with a 150 ms delay is plenty, and
the coach's screen is the same match replayed from the log. It was built for spectating.

**5v5 is designed so any seat can be AI.** Ten humans can't be expected to queue at the same time on
a portfolio site. Captains 1v1, one human per side leading AI teammates, is the PvP that can actually
fill. Seats open up to humans as the player count grows.

**Networking stays free.** Pente's multiplayer already uses Supabase Realtime, which is on the free
tier. Lockstep only needs a broadcast channel per match. Run each tick about 100 ms after the inputs
for it arrive, and every 60 ticks each peer sends its state hash. A mismatch is a desync, logged with
both logs attached. Vercel functions can't hold WebSockets, so no new paid service is needed.

## Tests that make a mode product-ready

Most of these don't exist yet. ✅ exists, ◐ partial, ✗ missing.

### Engine
| Test | Status | Ready when |
|---|---|---|
| Rule unit tests for every ability, possession change, clock and shot clock | ◐ 12 plain-node test files, no runner | `npm test` runs them all; CI blocks a merge on failure |
| Determinism: same seed + log → same state hash | ◐ one test in `fullCourt.test.js` | Hash checked every 60 ticks over 1,000 random logs |
| Frame-rate independence: 30, 60 and 144 fps give the same result | ✗ | Identical final hash at every rate |
| Cross-browser determinism (Chromium, Firefox, WebKit via Playwright) | ✗ | Identical hashes. **Expected to fail until the rules are in WebAssembly or the trig is replaced** |
| Golden replays: recorded real games replay to stored hashes | ✗ | A rules change either matches the goldens or bumps `rulesVersion` |
| Invariants under fuzzing (random commands, 10,000 games) | ✗ | No NaN, everyone on court, exactly one ball, score = box score, clock only runs down, every game ends |
| JS ↔ C++ parity, once the rules are ported | ✗ | The same logs give the same hashes in both |

### Balance and fun (the sweep becomes a gate)
| Test | Status | Ready when |
|---|---|---|
| `scripts/full-court-sweep.mjs` with thresholds | ◐ prints numbers | CI fails if pace, FG%, close games or touch share leave their band |
| No dominant pick: win rate by chosen player | ✗ | Every player's win rate is within 40–60% against the stand-in |
| Kit power by stat: no stat's ultimate is always best | ✗ | Points added per cast within a band across the three signatures |
| Hardwood meta (`bots/balance`) | ✅ Python | Moved into CI |
| Human playtests: 5 people, 3 games each, abandonment and a one-line "fun?" | ✗ | 4 of 5 finish the game and want another |

### Online
| Test | Status | Ready when |
|---|---|---|
| Lockstep under 50–300 ms latency, jitter and 5% loss (simulated) | ✗ | No desync in 500 games; input delay stays under 150 ms at 100 ms RTT |
| Desync detection, reconnect, and a bot taking over a dropped seat | ✗ | A dropped human becomes AI within 2 s, and the match finishes |
| Server re-runs every submitted result | ✗ (`resolve` trusts the client) | A forged win or a doctored log is rejected; required before any leaderboard |
| API contracts, validation, rate limits | ◐ `match-routes.test.ts`, `validateBoard.test.ts` | Every bball route covered, including the new match and replay routes |
| Supabase Realtime quota under load | ✗ | Messages per match × expected matches stays inside the free tier with 2× headroom |

### Client
| Test | Status | Ready when |
|---|---|---|
| End-to-end per mode: pick → play → final (Playwright) | ◐ ad-hoc scripts in the scratchpad | In the repo, run in CI for every mode |
| **Touch controls** | ✗ **Full Court can't be played on a phone today.** Moving needs a right-click, and touch sends a left-click | Tap to move, a drag or button to pass, the ability buttons; one whole game played by touch in CI |
| Performance budget | ✗ | ≥ 55 fps with 4× CPU throttling at phone size; first load under the current bundle (warning today: a chunk over 500 kB) |
| Memory | ✗ | Heap is flat after 5 games in a row |
| Visual regression | ✗ | Screenshot diffs at desktop and phone size for the pick, play and final screens |
| Accessibility | ◐ reduced motion is respected | Passing lanes and team colours read without colour (shape or dash, not just red vs green); HUD contrast AA; menus usable by keyboard and screen reader |
| Saves and settings survive a schema change | ✗ | Versioned localStorage with a migration test |
| Offline / backend down | ◐ static roster fallback | Every mode starts with the API down; online modes say why they're unavailable |

### Release
| Gate | Status |
|---|---|
| `deploy-pages.yml` runs the tests before deploying | ✗ It builds and deploys without running a test |
| Launcher smoke test | ✅ `launcher.yml` |
| Telemetry: `game_start`, `game_end`, mode, abandon, with no personal data | ✗ for Full Court (zero-next's `trackGame()` pattern exists) |
| A `rulesVersion` in every replay and save | ✗ |

### Not a test, but it blocks "product"
Real NBA player names are fine in a free portfolio piece. **Charging money** for a game built on them
(premium tiers, Rung 5) needs group licensing from the players' association. Before any paid tier,
either license them or switch to fictional players with real-stat archetypes. This note isn't legal
advice; get one answer before pricing anything.

## Order of work

1. **Make the engine honest:** `npm test` gated in CI, commands stamped with their tick, state
   hashes, and touch controls. Nothing else is shippable until these exist, and they're small.
2. **Solo:** Full Court M1 (Season) and the Daily Challenge, verified on the server by replay.
3. **Port the rules to `shared-core`** (M2), with the parity and cross-browser tests as its finish
   line.
4. **Coach + Player co-op** on Supabase lockstep, with the network tests.
5. **Captains 1v1, then more human seats** as real queue numbers justify them.
