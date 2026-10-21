# Hardwood Launcher

A small desktop launcher for Hardwood Autochess, the game in this repository:
install, patch and launch the game, plus a native C++ build of its simulation engine.
Electron, React and TypeScript.

A personal project, built to learn and show desktop-client work end to end:
a web UI in a desktop shell, chunked patching with rollback, and C++ shared
between the web build (WebAssembly) and the desktop build (a native Node addon).

**Status:** M1 — install and play, offline. Next: M2, chunked patching with rollback.
Plan: [`docs/design/launcher-plan.md`](../docs/design/launcher-plan.md).

## Run it

From this `launcher/` directory (the game's own dependencies come first, from
the repo root):

```bash
(cd .. && npm install)
npm install
npm run stage-game # build Hardwood into payload/ with a SHA-256 manifest
npm run dev        # hot-reloading app
npm run build      # production build into out/
npm run smoke      # fresh profile: check the window, install, play, exit 0 or 1
npm test           # unit tests
```

## How install works

- **Staging** (`scripts/stage-game.mjs`) builds the game for the launcher
  (base `/`, no API, so it runs offline on its bundled roster and practice
  opponent) and writes `payload/hardwood/manifest.json`: every file with its
  size and SHA-256. M2 publishes the same manifest as a release.
- **Install** (`src/main/install.ts`) copies into a sibling `.partial`
  directory, verifying each file's hash before writing it, and renames it into
  place only when everything verified. A corrupted file or a failed update
  leaves the previous install playable; tests cover both.
- **Play** opens the game in its own window, served from `game://hardwood/`
  (`src/main/protocol.ts`): a privileged scheme, because the engine fetches its
  `.wasm` and `fetch` doesn't work on `file://`. Requests are confined to the
  install directory (path-traversal guard, tested), and the game page gets its
  own CSP with `connect-src 'self'`.
- **Progress** streams from main over one channel; the UI reads it through
  `useSyncExternalStore` (`src/renderer/src/progressStore.ts`), and the library
  re-reads on every finished install, whoever started it.

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
