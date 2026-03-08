# B-Ball Tactics: Hardwood Autochess

A basketball auto-battler built with a C++ WebAssembly physics engine, Vue 3 frontend, and Python/FastAPI backend.

## Project Structure

```
BballTactics/
├── include/                 # C++ headers
│   ├── Vector.h             # Vector2D + Vector3D math
│   ├── PlayerEntity.h       # Unified player type (stats, movement, abilities)
│   ├── Basketball.h         # Ball entity with 3D arc/bounce physics
│   ├── Court.h              # Court dimensions, team rosters
│   ├── SynergyEngine.h      # Franchise/archetype buff system
│   ├── GameEconomy.h        # Salary cap cost tiers + Z-score normalizer
│   ├── GameSeason.h         # Round state machine (5v5, 3v3, draft lottery)
│   ├── ShotProbability.h    # Contest-aware shot probability
│   ├── GameManager.h        # Master state machine + Wasm-facing API
│   └── json.hpp             # nlohmann/json (single-header JSON library)
├── src/                     # C++ implementations
│   ├── PlayerEntity.cpp
│   ├── Basketball.cpp
│   ├── Court.cpp
│   ├── SynergyEngine.cpp
│   ├── GameEconomy.cpp
│   ├── GameSeason.cpp
│   ├── ShotProbability.cpp
│   ├── GameManager.cpp
│   └── Bindings.cpp         # Single EMSCRIPTEN_BINDINGS block
├── client/                  # Vue 3 SFCs (compiled by Vite)
│   ├── App.vue              # Root: manages game phases (tutorial → planning → sim)
│   ├── main.js              # Vue app entry point
│   ├── components/
│   │   ├── CourtCanvas.vue  # Real-time sim rendering (rAF loop + JS fallback)
│   │   ├── PlanningPhase.vue# Drag-and-drop formation editor
│   │   └── TutorialPhase1.vue # Guided onboarding (Coach Miller)
│   └── composables/
│       └── useMatchmaking.js# Vue composable for ghost lobby matchmaking
├── public/                  # Static assets served by Vite
│   ├── engine.js            # Emscripten JS glue (88KB)
│   ├── engine.wasm          # Compiled C++ engine (195KB)
│   └── engine_roster.json   # Player data (5 players, z-score normalized stats)
├── CMakeLists.txt           # Emscripten build config → outputs to public/
├── test_engine.cpp          # C++ test suite (10 tests)
├── index.html               # Vite entry point
├── package.json             # Node deps (vite, vue, @vitejs/plugin-vue)
├── vite.config.js           # Vite config (proxies /api → FastAPI :8000)
├── server.py                # FastAPI backend (runs, matchmaking, board states)
├── scraper.py               # NBA data pipeline (Z-score normalization)
├── test_scraper.py          # Python unit tests for stat pipeline
└── createTables.txt         # PostgreSQL schema (players, runs, board_states)
```

## What's Working

### C++ Engine
- **Unified type system**: Single `PlayerEntity` replaces three old player types. All fields default-initialized.
- **Header/source split**: `include/` + `src/` layout with `#pragma once` guards.
- **Single Wasm bridge**: One `EMSCRIPTEN_BINDINGS` block in `Bindings.cpp` exposes `GameManager` to JS.
- **SynergyEngine**: `StartRound()` calls `AnalyzeRoster()` with active roster. Franchise, Twin Towers, Splash Family, and 7 Seconds or Less synergies functional.
- **LoadRosterJSON**: Parses `[{id, name, cost, stats: {shooting, speed, defense}}]` via nlohmann/json. Sets cost + defense on `PlayerEntity`. Handles bad/empty input gracefully.
- **StartRound positioning**: Converts planning-grid coordinates (0-4) to sim-court positions (800x400). Auto-assigns `CUT_TO_BASKET` plays with spread targets.
- **Bug fixes applied**: EliteShooter stacking guard, `std::abs()` for floats, transition checks both axes, exponential decay shot probability, uninitialized members, full Vector3D operators.
- **10 passing tests**: movement, synergy detection, stat clamping, limitless range no-stack, transition both-axes, shot probability bounds, default init, Vector3D operators, LoadRosterJSON, LoadRosterJSON bad input.

### Vue Frontend (Vite + Vue 3)
- **App.vue**: Phase state machine (tutorial → planning → sim). Loads roster from `engine_roster.json`. Passes `courtLineup` from PlanningPhase to CourtCanvas.
- **PlanningPhase.vue**: Drag-and-drop grid. Players dragged to court call `SpawnPlayer` + `SetPlayerCoordinates`; dragging back calls `RemovePlayer`. Emits lineup data on lock-in.
- **CourtCanvas.vue**: rAF-driven sim loop. Reads engine state via `GetGameStateJSON()` when available. JS fallback mode: target-based movement using player speed stats when engine isn't loaded. Player dots show abbreviated names. Scoring probability scales with players near the basket. Bot opponents move with target-seeking behavior.
- **TutorialPhase1.vue**: Coach Miller guided onboarding.
- **Vite build tooling**: `npm run dev` with HMR, `npm run build` for production. Engine loaded via `<script src="/engine.js">` with graceful fallback.

### Data Pipeline
- `scraper.py`: Z-score normalization. Outputs `engine_roster.json` with `{id, name, cost, stats: {shooting, speed, defense}}`.
- `test_scraper.py`: 3 passing tests (Z-score clamping, economy tiers, payload structure).

### Backend
- `server.py` (FastAPI): Three endpoints (`/api/run/start`, `/api/match/submit-and-fetch`, `/api/match/resolve`). Ghost lobby matchmaking with bot fallback. Async DB session factory with configurable `DATABASE_URL`.
- `useMatchmaking.js`: Vue composable for the matchmaking HTTP flow.
- `createTables.txt`: PostgreSQL schema for players, runs, and board_states.

### Wasm Build
- Emscripten 5.0.2 via Homebrew.
- CMakeLists.txt targets `engine` with `-lembind`, `-sMODULARIZE=1`, `-sEXPORT_NAME=Module`, `-sALLOW_MEMORY_GROWTH=1`.
- Outputs `public/engine.js` + `public/engine.wasm`.

## Build

### Prerequisites
```bash
brew install cmake node python emscripten
pip install fastapi uvicorn sqlalchemy aiosqlite
npm install
```

### Run C++ Tests (native, no Emscripten needed)
```bash
g++ -std=c++17 -Iinclude -o test_runner test_engine.cpp \
  src/PlayerEntity.cpp src/Court.cpp src/Basketball.cpp \
  src/SynergyEngine.cpp src/GameEconomy.cpp src/GameSeason.cpp \
  src/ShotProbability.cpp src/GameManager.cpp
./test_runner
```

### Compile to Wasm
```bash
mkdir -p build && cd build
emcmake cmake ..
emmake make
# Outputs: public/engine.js + public/engine.wasm
```

### Run Frontend (dev)
```bash
npm run dev
# Opens at http://localhost:5173, proxies /api → localhost:8000
```

### Run Backend
```bash
uvicorn server:app --reload --port 8000
```

### Run Python Tests
```bash
python3 test_scraper.py
```

### Generate Roster Data
```bash
python3 -c "from scraper import NBADatasetProcessor; p = NBADatasetProcessor(); p.build_engine_payload(); p.export_json()"
```

## Next Steps

### Phase 7: Sim Gameplay Loop (High Priority)
- [ ] **Ball entity in sim**: Spawn a `Basketball` in `StartRound()`, render it in CourtCanvas. Pass/shoot/steal actions should move the ball between players.
- [ ] **Possession system**: Track which team/player has the ball. After a score, reset possession. Implement inbound/tip-off.
- [ ] **Shot attempts**: When a player reaches the basket area, trigger `ShotProbability` to determine make/miss. Animate the arc using `Basketball::Update()`.
- [ ] **Defensive actions**: Closest defender contests shots (affects `ShotProbability`). Steal attempts based on defense stat vs. ball handler's speed.
- [ ] **Rebound logic**: On a miss, nearby players compete for the rebound (height-weighted magnet pull).
- [ ] **Round outcome**: Replace random scoring with actual sim-driven scores. Emit `sim-complete` with final score.

### Phase 8: Economy & Progression (Medium Priority)
- [ ] **Shop randomization**: Serve a random pool of 5 players per round from the full roster, weighted by cost tier and current round number.
- [ ] **Gold/salary system**: Wire `GameEconomy` salary cap into the frontend. Show budget remaining. Selling players refunds partial cost.
- [ ] **Multi-round flow**: After sim ends, return to planning phase. Track wins/losses across rounds. Implement season progression from `GameSeason`.
- [ ] **Roster endpoint**: Add `/api/roster` to serve `engine_roster.json` from the backend instead of static file.

### Phase 9: Content & Polish (Lower Priority)
- [ ] **Playground PvE rounds**: When `currentRound % 5 == 0`, load historical trio JSON, switch to 3v3 half-court, loot-drop rewards.
- [ ] **Lockdown synergy**: `lockdownCount` is tracked in SynergyEngine but no buff is created. Design the defensive synergy tier.
- [ ] **Canvas rendering**: Replace DOM-based player dots with HTML5 Canvas or WebGL for smoother rendering with 10+ entities.
- [ ] **Live data source**: Replace mock data in `scraper.py` with a real NBA stats API (nba_api package or balldontlie v2).
- [ ] **Matchmaking integration**: Wire `useMatchmaking.js` into the game flow — submit board state after planning, fetch opponent from backend.
- [ ] **Deploy pipeline**: Containerize (Docker), set up CI for Wasm builds + frontend bundle, deploy to a hosting platform.
