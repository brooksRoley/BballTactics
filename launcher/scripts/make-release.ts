// Turn a staged game (payload/<id>/files + manifest.json for its version) into
// a release feed: content-defined chunks, a versioned manifest, and
// channel.json last. Deploy-pages publishes the feed with the web game.
//
//   npx tsx scripts/make-release.ts --payload payload/hardwood --out ../dist/launcher-feed
//   (--version overrides the staged version; the smoke run uses it for a v2)
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { buildRelease, writeFeed } from '../src/main/release'

const { values } = parseArgs({
  options: { payload: { type: 'string' }, out: { type: 'string' }, version: { type: 'string' } },
})
if (!values.payload || !values.out) {
  console.error('usage: make-release --payload <payload/id> --out <feed dir> [--version v]')
  process.exit(2)
}

async function main(payloadArg: string, out: string, version?: string): Promise<void> {
  const payload = resolve(payloadArg)
  const staged = JSON.parse(await readFile(join(payload, 'manifest.json'), 'utf8')) as { id: string; version: string }
  const { release, chunks } = await buildRelease(join(payload, 'files'), staged.id, version ?? staged.version)
  await writeFeed(resolve(out), release, chunks)
  const bytes = release.files.reduce((n, f) => n + f.size, 0)
  console.log(`released ${release.id} ${release.version}: ${release.files.length} files, ${chunks.size} chunks, ${(bytes / 1024).toFixed(0)} KB`)
}

main(values.payload, values.out, values.version).catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
