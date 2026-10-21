import { describe, expect, it } from 'vitest'
import { assertSecure, isAppUrl, secureWebPreferences } from './security'

describe('window security baseline', () => {
  it('passes its own check', () => {
    expect(() => assertSecure(secureWebPreferences('/preload.js'))).not.toThrow()
  })

  it.each([
    ['nodeIntegration', { nodeIntegration: true }],
    ['contextIsolation', { contextIsolation: false }],
    ['sandbox', { sandbox: false }],
    ['webSecurity', { webSecurity: false }],
    ['webviewTag', { webviewTag: true }],
  ])('rejects a window that weakens %s', (_name, override) => {
    expect(() => assertSecure({ ...secureWebPreferences('/preload.js'), ...override })).toThrow(/Insecure window/)
  })

  it('rejects a window that leaves the flags unset', () => {
    expect(() => assertSecure({ preload: '/preload.js' })).toThrow(/contextIsolation/)
  })

  it('only treats the app itself as navigable', () => {
    expect(isAppUrl('file:///app/out/renderer/index.html')).toBe(true)
    expect(isAppUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true)
    expect(isAppUrl('https://example.com/')).toBe(false)
    expect(isAppUrl('http://localhost:5173/')).toBe(false)
  })
})
