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
│   └── engine_roster.json   # Player data (20 players, z-score normalized stats)
├── CMakeLists.txt           # Emscripten build config → outputs to public/
├── test_engine.cpp          # C++ test suite (10 tests)
├── index.html               # Vite entry point
├── package.json             # Node deps (vite, vue, @vitejs/plugin-vue)
├── vite.config.js           # Vite config (proxies /api → FastAPI :8000)
├── server.py                # FastAPI backend (runs, matchmaking, board states)
├── scraper.py               # NBA data pipeline (Z-score normalization)
├── test_scraper.py          # Python unit tests for stat pipeline
├── createTables.txt         # PostgreSQL schema (players, runs, board_states)
├── requirements.txt         # Python deps for the API
├── Dockerfile               # Multi-stage build: Node (Vite) → Python (uvicorn)
├── docker-compose.yml       # Local dev: api + postgres services
├── fly.toml                 # Fly.io deployment config (app: bballtactics)
├── .env.production          # VITE_API_BASE_URL for GitHub Pages → Fly.io
├── docker/
│   └── init.sql             # DB initialization script (run once on fresh Postgres)
└── bots/                    # Testing + analysis bots (planned — see Phase 10)
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
- **App.vue**: Phase state machine (tutorial → planning → sim → result → next round). Loads roster from backend `/api/roster` with static file fallback. Passes `courtLineup` from PlanningPhase to CourtCanvas.
- **Economy system**: Weighted shop randomization by cost tier and round number (early rounds favor cheap units, late rounds unlock expensive ones). Gold income scales with round. Reroll shop for 1G. Sell players from bench for partial refund (floor of cost/2).
- **Win/loss tracking**: Explicit W/L record displayed in status bar and result screen. HP system (100 HP, -20 per loss). Season ends at round 10 or 0 HP.
- **PlanningPhase.vue**: Drag-and-drop grid with tap-to-place mobile support. Players dragged to court call `SpawnPlayer` + `SetPlayerCoordinates`; dragging back calls `RemovePlayer`. Sell button on bench players. Emits lineup data on lock-in.
- **CourtCanvas.vue**: rAF-driven sim loop. Reads engine state via `GetGameStateJSON()` when available. JS fallback mode: target-based movement using player speed stats when engine isn't loaded. Player dots show abbreviated names. Scoring probability scales with players near the basket. Bot opponents move with target-seeking behavior.
- **TutorialPhase1.vue**: Coach Miller guided onboarding.
- **Vite build tooling**: `npm run dev` with HMR, `npm run build` for production. Engine loaded via `<script src="/engine.js">` with graceful fallback.

### Data Pipeline
- `scraper.py`: Z-score normalization. Outputs `engine_roster.json` with `{id, name, cost, stats: {shooting, speed, defense}}`.
- `test_scraper.py`: 3 passing tests (Z-score clamping, economy tiers, payload structure).

### Backend
- `server.py` (FastAPI): Four endpoints (`/api/run/start`, `/api/match/submit-and-fetch`, `/api/match/resolve`, `/api/roster`). Ghost lobby matchmaking with bot fallback. Roster endpoint serves `engine_roster.json` from the backend. Async DB session factory with configurable `DATABASE_URL`. CORS configured for GitHub Pages origin. Mounts `dist/` as static files when present (production only).
- `useMatchmaking.js`: Vue composable for the matchmaking HTTP flow. Uses `VITE_API_BASE_URL` env var so GitHub Pages calls the Fly.io API directly.
- `createTables.txt`: PostgreSQL schema for players, runs, and board_states.

### Deployment
- **API**: Deployed to Fly.io at `https://bballtactics.fly.dev` (`fly.toml`, `Dockerfile`).
- **Database**: Fly.io Postgres (`bballtactics-db`). Tables initialized via `docker/init.sql`. Attached to the app — `DATABASE_URL` injected automatically as a secret.
- **Frontend**: Deployed to GitHub Pages at `https://brooksroley.github.io/BballTactics/` via `npm run deploy`. Production builds use `VITE_API_BASE_URL=https://bballtactics.fly.dev` so all API calls route to Fly.io.
- **Local dev**: `docker compose up` runs API + Postgres locally. Vite proxy handles `/api` → `localhost:8000`.

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

### Run with Docker (local Postgres)
```bash
docker compose up --build
# App at http://localhost:8000
```

### Deploy to Fly.io
```bash
flyctl deploy -a bballtactics
```

### Deploy Frontend to GitHub Pages
```bash
npm run deploy
```

### Initialize a fresh Fly.io Postgres database
```bash
flyctl postgres connect -a bballtactics-db < docker/init.sql
```

### Run Python Tests
```bash
python3 test_scraper.py
```

### Generate Roster Data
```bash
python3 -c "from scraper import NBADatasetProcessor; p = NBADatasetProcessor(); p.build_engine_payload(); p.export_json()"
```

### Phase 8: Economy & Progression (Complete)

- [x] **Shop randomization**: Weighted random pool of 5 players per round. Early rounds (1-3) favor cost 1-2 units; mid rounds (4-6) open cost 3-4; late rounds (7-10) unlock cost 5 at meaningful rates.
- [x] **Gold/salary system**: Gold display in status bar. Buy players from shop, sell from bench for floor(cost/2) refund. Reroll shop for 1G. Income scales with round (base 5 + interest up to 5).
- [x] **Multi-round flow**: Full game loop — planning → sim → result → next round. W/L record tracked and displayed. HP-based elimination (100 HP, -20 per loss). Season ends at round 10 or 0 HP.
- [x] **Roster endpoint**: `GET /api/roster` serves `engine_roster.json` from the backend. Frontend tries API first, falls back to static file for gh-pages.

### Phase 9: Deploy & Infrastructure (Complete)

- [x] **Containerize**: Multi-stage `Dockerfile` (Node builds Vite frontend → Python serves API + static files). `docker-compose.yml` for local dev with Postgres.
- [x] **Fly.io deploy**: `fly.toml` configured. API live at `https://bballtactics.fly.dev`.
- [x] **Postgres on Fly.io**: `bballtactics-db` provisioned and attached. Schema initialized from `docker/init.sql`.
- [x] **GitHub Pages → Fly.io wiring**: `VITE_API_BASE_URL` in `.env.production` points all API calls from GitHub Pages to the live Fly.io backend. CORS middleware allows the GitHub Pages origin.
- [x] **Matchmaking integration**: `useMatchmaking.js` wired into the game flow with environment-aware API base URL.

### Phase 10: Testing & Balance (Next)

#### Bot 1: E2E API Test Suite (`bots/e2e/`)

- [x] `conftest.py` — pytest fixtures: `httpx.Client`, `run_id`, `roster`. Session-scoped health ping for Fly.io cold starts.
- [x] `board_fixtures.py` — realistic `board_data` payloads matching the Vue `onCourt` array schema (`{id, name, cost, stats, courtX, courtY}`).
- [x] `test_run_lifecycle.py` — full 10-round win run, 5-loss elimination, HP math assertions, 400 on dead run.
- [x] `test_ghost_matchmaking.py` — bot fallback when DB is empty, two runs pairing as ghosts, `board_data` string-vs-dict handling (SQLite vs Postgres).
- [x] `test_hp_and_status.py` — health decrements, `'won'`/`'lost'` terminal states, resolving a closed run returns 400.

**Key notes:**
- Use `httpx` (sync) — no `pytest-asyncio` needed. CORS is browser-only, Python clients are unaffected.
- Tests against Fly.io: add `timeout=30.0` on session fixture for cold starts.
- `opponent_board` from SQLite is a raw JSON string; from Postgres it is a parsed dict. Tests must handle both.

#### Bot 2: Balance Analysis (`bots/balance/`)

- [x] `engine_runner/game_runner.cpp` — thin `main()` that reads a JSON matchup from stdin, ticks `GameManager` for N frames, writes `{homeScore, awayScore, winner}` to stdout.
  - Must **exclude** `src/Bindings.cpp` from the g++ build (it imports `<emscripten/bind.h>`).
  - Must override the fixed RNG seed `{42}` in `Court.h` — all 200 runs of the same matchup are otherwise identical.
  - Accept both teams from stdin rather than calling `SpawnBotOpponents()` to enable true team-vs-team analysis.
- [x] `engine_runner/Makefile` — g++ build command mirroring the existing `test_runner` compile pattern.
- [x] `simulate.py` — subprocess loop calling `game_runner` for each matchup combination. Returns a pandas DataFrame (one row per game).
- [x] `analyze.py` — win rates by cost tier, individual player win rates (flag outliers), synergy effectiveness, formation heatmap (5×5 grid), HP damage curve across 10 rounds.
- [x] `run_analysis.py` — entrypoint: simulate → analyze → save charts to `bots/balance/charts/`.

**Key architectural note:** The ghost board from `board_states` affects the visual display only — `StartRound()` always calls `SpawnBotOpponents()` with hardcoded stats. The C++ sim does not load the opponent's board data. This is a known limitation to address if true ghost-vs-ghost simulation is desired.

**Dependencies** (`bots/requirements-bots.txt`):
```
httpx>=0.27.0
pytest>=8.0.0
pandas>=2.2.0
numpy>=1.26.0
matplotlib>=3.9.0
scipy>=1.13.0
tqdm>=4.66.0
```

### Phase 11: Content & Polish (Lower Priority)
- [ ] **Lockdown synergy**: `lockdownCount` is tracked in SynergyEngine but no buff is created. Design the defensive synergy tier.
- [ ] **Live data source**: Replace mock data in `scraper.py` with a real NBA stats API (nba_api package or balldontlie v2).
- [ ] **True ghost simulation**: Load the opponent's `board_data` from the DB into the C++ engine as the actual away team instead of spawning bot opponents.
