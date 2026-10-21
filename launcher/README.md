# Hardwood Launcher

A small desktop launcher for Hardwood Autochess, the game in this repository:
install, patch and launch the game, plus a native C++ build of its simulation engine.
Electron, React and TypeScript.

A personal project, built to learn and show desktop-client work end to end:
a web UI in a desktop shell, chunked patching with rollback, and C++ shared
between the web build (WebAssembly) and the desktop build (a native Node addon).

**Status:** M0, the scaffold. Plan: [`docs/design/launcher-plan.md`](../docs/design/launcher-plan.md).

## Run it

From this `launcher/` directory:

```bash
npm install
npm run dev        # hot-reloading app
npm run build      # production build into out/
npm run smoke      # start the built app, check it, exit 0 or 1
npm test           # unit tests
```

## Security baseline

The renderer shows content from the network, so it is treated as untrusted:

- `contextIsolation`, `sandbox`, no `nodeIntegration`, no `<webview>`; a window
  with weaker settings throws before it is created (`src/main/security.ts`,
  covered by tests).
- A strict Content-Security-Policy in `index.html`.
- The renderer reaches the system only through a typed preload API
  (`src/main/ipc.ts` → `src/preload/index.ts`); `ipcRenderer` is never exposed,
  and lint forbids Node or Electron imports in renderer code.
- Navigation is pinned to the app; external links open in the browser.
- `npm run smoke` checks this in a live window: the bridge answers and
  `require` / `process` are absent from the page.
