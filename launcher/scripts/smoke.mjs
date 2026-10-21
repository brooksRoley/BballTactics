// End-to-end check of the built app against a real (local) release feed:
//   1. release the staged game as v1 into a feed and serve it over HTTP
//   2. fresh profile: install from the feed, play, check the engine runs
//   3. release v2 with a one-line change; same profile: update, check it
//      downloaded a small fraction of the game, then roll back
// Exits 0 only if both stages pass. Needs `npm run stage-game` and `npm run build` first.
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'

const launcher = resolve(import.meta.dirname, '..')
const payload = join(launcher, 'payload', 'hardwood')
const work = mkdtempSync(join(tmpdir(), 'hw-smoke-'))
const feedDir = join(work, 'feed')
const profile = join(work, 'profile')

const release = (payloadDir, version) =>
  execFileSync('npx', ['tsx', 'scripts/make-release.ts', '--payload', payloadDir, '--out', feedDir, ...(version ? ['--version', version] : [])], {
    cwd: launcher,
    stdio: 'inherit',
  })

const server = createServer((req, res) => {
  try {
    res.end(readFileSync(join(feedDir, decodeURIComponent(new URL(req.url, 'http://x').pathname))))
  } catch {
    res.statusCode = 404
    res.end()
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const feedUrl = `http://127.0.0.1:${server.address().port}/`

function stage(name) {
  return new Promise((resolveStage) => {
    const child = spawn(electron, ['.', '--smoke'], {
      cwd: launcher,
      stdio: 'inherit',
      env: { ...process.env, LAUNCHER_FEED_URL: feedUrl, LAUNCHER_USER_DATA: profile, LAUNCHER_SMOKE_STAGE: name },
    })
    child.on('exit', (code) => resolveStage(code ?? 1))
  })
}

let code = 1
try {
  const v1 = JSON.parse(readFileSync(join(payload, 'manifest.json'), 'utf8')).version
  release(payload, undefined)
  if ((await stage('install')) !== 0) throw new Error('install stage failed')

  // v2: the same build plus one line appended to its largest script.
  const v2Payload = join(work, 'payload-v2')
  cpSync(payload, v2Payload, { recursive: true })
  const assets = join(v2Payload, 'files', 'assets')
  const largest = readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .sort((a, b) => statSync(join(assets, b)).size - statSync(join(assets, a)).size)[0]
  appendFileSync(join(assets, largest), '\n;/* smoke: one-line change */\n')
  release(v2Payload, `${v1}-smoke2`)
  if ((await stage('update')) !== 0) throw new Error('update stage failed')
  code = 0
} catch (e) {
  console.error(`smoke: ${e.message}`)
} finally {
  server.close()
}
process.exit(code)
