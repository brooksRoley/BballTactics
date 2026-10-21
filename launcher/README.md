# Hardwood Launcher

A small desktop launcher for Hardwood Autochess, the game in this repository:
install, patch and launch the game, plus a native C++ build of its simulation engine.
Electron, React and TypeScript.

A personal project, built to learn and show desktop-client work end to end:
a web UI in a desktop shell, chunked patching with rollback, and C++ shared
between the web build (WebAssembly) and the desktop build (a native Node addon).

**Status:** M2: updates that download only what changed, resume, verify, and
roll back. Next: M3, the C++ engine as a native Node addon.
Plan: [`docs/design/launcher-plan.md`](../docs/design/launcher-plan.md).

## Run it

From this `launcher/` directory (the game's own dependencies come first, from
the repo root):

```bash
(cd .. && npm install)
npm install
npm run stage-game # build Hardwood into payload/
npm run make-release -- --payload payload/hardwood --out /tmp/feed   # a release feed
npm run dev        # hot-reloading app (LAUNCHER_FEED_URL=… to use a local feed)
npm run build      # production build into out/
npm run smoke      # against a local feed: install + play, then update + roll back
npm test           # unit tests
```

The app reads releases from `https://brooksroley.github.io/BballTactics/launcher-feed/`,
which the Pages deploy publishes beside the web game; `LAUNCHER_FEED_URL`
points it elsewhere.

## How updates work

- **Content-defined chunking** (`src/main/chunker.ts`): files split where a gear
  rolling hash matches a mask (avg 16 KiB, min 4, max 128), so boundaries
  follow content. An edit changes the chunk it lands in; later chunks keep their
  bytes and hashes. Fixed-size chunks would shift every chunk after the edit.
  The max is 8× the average because a forced cut sits at a fixed offset and
  cascades: at 4× it fired for ~2% of chunks and turned a one-line change into
  a 160 KB download (caught by a test).
- **The feed** (`src/main/release.ts`) is static files: `channel.json` (written
  last, by rename), `manifests/<version>.json`, `chunks/<sha256>`. A client only
  needs the latest release's chunks — everything older is on its disk — so the
  feed holds one release at a time and any static host serves it.
- **Update** (`src/main/updater.ts`): every chunk the new release needs is
  looked up in the installed files first (read by offset, hash-verified), then
  in the resume cache; only the rest is downloaded, four at a time, each
  verified, a bad one refetched up to three times. Files are assembled into
  `versions/<v>.partial`, verified whole, and renamed into place, so the
  version being played is never touched.
- **Resume / pause**: each verified chunk is kept, so an interrupted or paused
  update continues where it stopped.
- **Rollback**: the previous version stays on disk; rolling back flips which
  one is current. Instant, no download.
- Measured on the real game (smoke run): a one-line change downloads
  **16 KB of 1.07 MB (1.5%)**.
- Not yet: release signing. Hashes prove the bytes match the manifest, not
  who published it — M4, with code signing.

## How install works

- **Staging** (`scripts/stage-game.mjs`) builds the game for the launcher
  (base `/`, no API, so it runs offline on its bundled roster and practice
  opponent); `scripts/make-release.ts` turns that into a feed release.
- **A fresh install** is an update from nothing: every chunk is downloaded
  and verified, assembled, and renamed into place.
- **Play** opens the game in its own window, served from `game://hardwood/`
  (`src/main/protocol.ts`): a privileged scheme, because the engine fetches its
  `.wasm` and `fetch` doesn't work on `file://`. Requests are confined to the
  install directory (path-traversal guard, tested), and the game page gets its
  own CSP with `connect-src 'self'`.
- **Progress** streams from main over one channel; the UI reads it through
  `useSyncExternalStore` (`src/renderer/src/progressStore.ts`), which also
  timestamps it for speed and time left. The library re-reads on every
  finished install, whoever started it, and "done" fires only after the new
  version is recorded.

## Security baseline

The renderer shows content from the network, so it is treated as untrusted:

- `contextIsolation`, `sandbox`, no `nodeIntegration`, no `<webview>`; a window
  with weaker settings throws before it is created (`src/main/security.ts`,
  covered by tests). Game windows get the same settings and no preload at all.
- A strict Content-Security-Policy in `index.html`.
- The renderer reaches the system only through a typed preload API
  (`src/main/ipc.ts` → `src/preload/index.ts`); `ipcRenderer` is never exposed,
  and lint forbids Node or Electron imports in renderer code. Main validates
  every game id it receives.
- Navigation is pinned to the app (and each game to its own origin); external
  links open in the browser.
- `npm run smoke` checks this in a live window: the bridge answers and
  `require` / `process` are absent from the page.
