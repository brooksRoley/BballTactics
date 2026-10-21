import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

/**
 * Installed games are served from `game://<id>/…` rather than file://, because
 * the engine fetches its .wasm, and fetch() doesn't work on file:// URLs. A
 * standard, secure scheme also gives each game its own origin.
 */
export const GAME_SCHEME = 'game'

export const GAME_SCHEME_PRIVILEGES = {
  scheme: GAME_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/**
 * The game page's policy. Embind builds its bindings with `new Function`, so
 * script-src needs 'unsafe-eval'; Pixi spawns blob workers; Vue writes style
 * attributes. connect-src stays 'self' — an installed game talks to nothing.
 */
export const GAME_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ')

/** Maps a URL path onto a file inside `root`, or null if it would escape it. */
export function resolveGamePath(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const rel = decoded.replace(/^\/+/, '') || 'index.html'
  const base = resolve(root)
  const full = resolve(base, rel)
  return full.startsWith(base + sep) ? full : null
}

/** Serves one request against an install directory (or 404s). */
export async function serveGameFile(installDir: string | null, url: string): Promise<Response> {
  const notFound = () => new Response('Not found', { status: 404 })
  if (!installDir) return notFound()
  const file = resolveGamePath(installDir, new URL(url).pathname)
  if (!file) return notFound()
  try {
    const body = await readFile(file)
    return new Response(body, {
      headers: {
        'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': GAME_CSP,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return notFound()
  }
}
