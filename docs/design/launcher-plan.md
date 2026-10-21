# Hardwood Launcher — project plan

Written 2026-10-21. A two-week, time-boxed project that makes one application
stronger: Riot Games, **Senior Software Engineer, Riot Client – Publishing
Platform** (web-tech variant, Greenhouse id 8222064, posted 2026-10-08).

## Why this project

The posting, in its own words:

- Required: 6+ years; "expertise in web technologies (React.js, Node.js) with
  application level complexity"; experience in C++; complex code bases.
- Desired: desktop applications, Electron, build pipelines.
- The job: "Develop and maintain desktop application features focusing on web
  tech, with the ability to integrate with and contribute C++ components."
  The Riot Client is where players play, discover and install Riot games.

What Brooks already has: ten years of web work and Node services; a C++17
engine (`shared-core`) compiled to WASM through CMake/Emscripten, also bound to
Python and Swift; real game literacy.

The gaps a reviewer will see: production React is 2017–19 (Grove was Vue),
the C++ is personal-project C++, and there is no Electron or desktop work.

**One project closes all three:** a small desktop launcher for Hardwood
Autochess, in Electron + React + TypeScript, that installs, patches and
launches the game, and loads the C++ engine as a native Node addon. It is the
role's job in miniature, built on a game he already made.

## Ground rules

- **Apply first, build second.** The application goes in this week with the
  repo link and M0–M1 done. The project is for the referral note, the screen
  and the follow-up, not a reason to wait. Postings close.
- **Time box: two weeks.** M2 is the core. If behind, cut M3's benchmark, then
  M4's Windows artifact — never the patcher.
- **No Riot names, logos or assets anywhere.** It is "Hardwood Launcher", a
  personal project modeled on the kind of work the role describes. The README
  says so. Never imply knowledge of Riot's internals.
- **Job sends come first.** This is the only feature work allowed before the
  week's sends are done (see the job-search tool's "build vs. send" rule).

## Architecture

```
BballTactics/
├── launcher/                      the desktop app (own package.json and CI)
│   ├── src/main/                      Electron main process (TypeScript)
│   ├── patcher/                   manifest diff, chunk download, verify, swap
│   ├── library.ts                 installed versions, launch, uninstall
│   └── sim-host.ts                utilityProcess hosting the native engine
│   ├── src/preload/               typed contextBridge API — the only IPC surface
│   ├── src/renderer/              React + TypeScript UI
│   │   ├── Library, GameDetail, Downloads, SimLab, Settings
│   │   └── state: one reducer per domain, useSyncExternalStore for progress
│   ├── scripts/make-release.ts    build → chunk → manifest → publish
│   └── e2e/                       Playwright (_electron) smoke tests
└── shared-core/bindings/node/     NEW: node-addon-api binding, built by cmake-js
```

Lives in BballTactics (not a new repo): the launcher installs and patches
this game, the release script runs in this repo's CI, and `shared-core` is
already a submodule here. One repo shows the game, its engine and its client.

Electron security baseline from day one: `contextIsolation: true`,
`sandbox: true`, `nodeIntegration: false`, a strict CSP, a typed preload API
(no raw `ipcRenderer` in the renderer), and every IPC payload validated in
main. This is a common interview topic and cheap to get right early.

## Milestones

Each one leaves something demoable, so stopping early still yields a story.

### M0 — Scaffold (day 1)
- electron-vite + React + TypeScript; ESLint, Vitest; GitHub Actions on push.
- Security baseline above, with a test that fails if a window is created with
  `nodeIntegration` or without `contextIsolation`.
- **Done when:** an empty window opens from CI-built code on macOS.

### M1 — Library and launch (days 2–3)
- Library screen: Hardwood's card, installed version, Play / Install / Update.
- Install from a local build of `dist-hardwood`; launch it in its own
  window served from disk (works offline).
- Keyboard navigation, visible focus, reduced-motion support: the accessibility
  bar from brooksroley.com, applied to a game client.
- **Done when:** a fresh machine can install and play Hardwood from the
  launcher. **Apply to Riot at this point** with the repo link.

### M2 — Patcher (days 4–7) — the core
- `make-release.ts` (runs in BballTactics CI): build → split files into
  content-addressed chunks (SHA-256) → write a versioned manifest → publish to
  GitHub Releases.
- Launcher: fetch the manifest, diff against the installed one, download only
  missing chunks (bounded concurrency), verify every hash, **resume** after
  interruption, assemble into a new version directory, then **swap
  atomically**. Keep the previous version for **one-click rollback**.
- Downloads screen: progress, speed, ETA, pause/resume, clear errors.
- Tests: manifest diff, a corrupted chunk is detected and refetched, a killed
  download resumes, a failed swap leaves the old version playable.
- **Done when:** publishing a one-line change to Hardwood downloads a few KB,
  not the whole build, and survives pulling the network mid-update.

### M3 — Native C++ (days 8–10)
- `shared-core/bindings/node`: node-addon-api wrapper of `GameManager`
  (`LoadRosterJSON`, `SetAwayTeamJSON`, `StartRound`, `SimulateGame`), built
  with cmake-js against Electron's headers. Same core, a fourth binding.
- Run it in a `utilityProcess`, never on the main or renderer thread.
- **Sim Lab** screen: pick two lineups, run the 300-game balance sweep
  natively, show win rate and score distribution live.
- Benchmark native vs. WASM for the same sweep; record the numbers and *why*
  (call overhead across the boundary, threads, memory).
- **Done when:** the sweep runs natively without freezing the UI, and the
  benchmark is in the README with an honest explanation.

### M4 — Pipeline (days 11–12)
- CI matrix: macOS + Windows. Build the native addon per platform, package
  with electron-builder (unsigned; the README says so and why).
- Playwright `_electron` smoke test in CI: launch → install → update → play.
- **Done when:** a tagged commit produces a Windows installer and a macOS app
  as release artifacts, and the smoke test gates them.

### M5 — The story (days 13–14)
- README top: GIF, download links, one paragraph, an architecture diagram.
- A post on brooksroley.com: "A small game launcher: chunked patching, a
  native C++ engine and Electron's security model." Linked from Projects.
- Three storybank entries for the interview coach:
  1. Designing the patcher (content addressing, atomic swap, rollback).
  2. The native/web boundary (N-API vs. WASM, threads, what the benchmark showed).
  3. Electron's security model and the IPC surface.
- Resume bullet (only once shipped), in `src/lib/resume.ts`, `resume.json` and the PDF.

## Using it in the search

| When | Move |
|---|---|
| M1 done | Apply to the Riot Client role; the letter names the repo. |
| M1 done | Referral search: former Grove / Zipongo colleagues now at Riot; IGDA OC mixer. One short note with the repo link. |
| M2–M3 done | Follow-up note to the recruiter or referrer with the GIF and one numbers line from the benchmark. |
| Screen booked | Rehearse the three stories with `agent.py mock`; drill React (hooks, reducers, rendering) since production React is the oldest skill. |

## Open questions

- Riot's in-office expectation for this team. West LA is ~60 miles each way;
  ask the recruiter on the first call, before investing further.
- Which Riot role was applied to before, and when. Don't repeat it.
- Electron version and cmake-js pairing: pin both in M0, since native addons
  are tied to Electron's ABI.
