// Build Hardwood Autochess from this repo into launcher/payload/hardwood and
// write its manifest: every file with its size and SHA-256. The launcher
// installs from this payload (M1); M2 publishes the same manifest as a release
// and installs by diffing it.
//
// The game is built for the launcher, not the web: base "/" (it is served from
// game://hardwood/) and an empty API base, so it runs fully offline on its
// bundled roster and practice opponent.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const repo = resolve(import.meta.dirname, '../..')
const out = resolve(import.meta.dirname, '../payload/hardwood')
const files = join(out, 'files')

rmSync(out, { recursive: true, force: true })
execFileSync('npx', ['vite', 'build', '--base=/', '--outDir', files, '--emptyOutDir'], {
  cwd: repo,
  env: { ...process.env, VITE_API_BASE: '' },
  stdio: 'inherit',
})

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
const sha = git('rev-parse', '--short', 'HEAD')
const dirty = git('status', '--porcelain', '--', '.', ':!launcher').length > 0
const version = `${git('log', '-1', '--format=%cs', 'HEAD')}-${sha}${dirty ? '-dirty' : ''}`

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const entries = walk(files)
  .filter((f) => !f.endsWith('.nojekyll'))
  .map((f) => {
    const data = readFileSync(f)
    return {
      path: relative(files, f).split(sep).join('/'),
      size: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    }
  })
  .sort((a, b) => a.path.localeCompare(b.path))

const manifest = { id: 'hardwood', version, builtAt: new Date().toISOString(), files: entries }
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const bytes = entries.reduce((n, e) => n + e.size, 0)
console.log(`staged hardwood ${version}: ${entries.length} files, ${(bytes / 1024).toFixed(0)} KB`)
