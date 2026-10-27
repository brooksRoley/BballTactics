# Full Court golden replays

Each JSON file is a recorded match: `rulesVersion`, `seed`, `humanId`, `options`, the tick-stamped
command `log`, how many `ticks` it ran, the final `hash` and the `checkpoints` (a state hash every
60 ticks). `determinism.test.js` replays each one and requires the same final hash and checkpoints.

**When a golden fails**, the rules changed how a recorded game plays. Either:

- the change was not meant to alter play: fix it until the goldens pass again; or
- it was meant to: bump `RULES_VERSION` in `client/moba/match.js`, then re-record and commit the
  new files with the rules change:

  ```
  node scripts/full-court-goldens.mjs --write   # re-record with the current rules
  node scripts/full-court-goldens.mjs           # check: every golden replays to its hash
  ```

The first checkpoint that differs tells you the second the games diverged. Goldens are checked
in one JS engine (Node's V8). Cross-browser replay is a known gap: `Math.sin`, `cos` and `hypot`
are not guaranteed bit-identical across engines (docs/design/game-modes.md).
