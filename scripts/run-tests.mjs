// npm test: run every plain-node test file under client/**/__tests__/ and fail
// if any of them fails. Each file is its own process (they are standalone
// scripts that throw or exit non-zero on failure), so one file's crash can't
// hide another's result. No test framework, no dependencies.
//
//   npm test                 every file
//   npm test -- fullCourt    only files whose path contains "fullCourt"
//
// FUZZ_GAMES=10000 npm test  runs the long fuzz (client/moba/__tests__/fuzz.test.js).
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const filters = process.argv.slice(2);

function findTests(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) findTests(full, out);
    else if (/[\\/]__tests__[\\/]/.test(full) && /\.test\.m?js$/.test(name)) out.push(full);
  }
  return out;
}

const files = findTests(join(root, 'client'))
  .map((f) => relative(root, f))
  .filter((f) => !filters.length || filters.some((s) => f.includes(s)))
  .sort();

if (!files.length) {
  console.error('No test files matched.');
  process.exit(1);
}

const failed = [];
const started = Date.now();
for (const file of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8', env: process.env });
  const ms = Date.now() - t0;
  const out = `${r.stdout || ''}${r.stderr || ''}`.trimEnd();
  // The file's own last word on itself, skipping Node's runtime warnings.
  const lines = (r.stdout || '').split('\n').filter((l) => l.trim());
  const summary = lines.length ? lines[lines.length - 1].trim() : 'no output';
  if (r.status === 0) {
    console.log(`PASS  ${file}  (${summary}, ${ms} ms)`);
  } else {
    failed.push(file);
    console.log(`FAIL  ${file}  (exit ${r.status ?? r.signal}, ${ms} ms)`);
    console.log(out.split('\n').map((l) => `      ${l}`).join('\n'));
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${files.length - failed.length} of ${files.length} test files passed in ${secs} s`);
if (failed.length) {
  console.log(`Failed: ${failed.join(', ')}`);
  process.exit(1);
}
