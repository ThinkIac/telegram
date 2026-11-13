import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const logosRoot = path.resolve(path.dirname(require.resolve('logos')), '..', '..')
const engineUrl = pathToFileURL(path.join(logosRoot, 'dist/src/modules/views/engine.js')).href
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = path.dirname(packageRoot)
const workspaceRoot = path.dirname(packagesRoot)

test('painel renderiza no SSR, inicia escuro e nao inclui token salvo', async () => {
  const cache = mkdtempSync(path.join(tmpdir(), 'telegram-ssr-'))
  const cwd = process.cwd()
  try {
    process.chdir(workspaceRoot)
    const engineModule = await import(engineUrl)
    const { SvelteEngine } = engineModule.default ?? engineModule
    const html = await new SvelteEngine(cache).render(
      path.join(packageRoot, 'views/Index.svelte'),
      'telegram__Index_ssr',
      {},
      packagesRoot,
    )
    assert.match(html, /Telegram/)
    assert.match(html, /data-theme="dark"/)
    assert.doesNotMatch(html, /tokenVisible|maskedToken/)
  } finally {
    process.chdir(cwd)
    rmSync(cache, { recursive: true, force: true })
  }
})
