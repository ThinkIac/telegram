import test from 'node:test'
import assert from 'node:assert/strict'

import { TelegramManager } from '../manager.js'

test('autorizacao e fail-closed para chat desconhecido, inativo ou erro no store', async () => {
  const unknown = new TelegramManager({ listChats: async () => [] })
  assert.equal(await unknown.isAuthorized('100'), false)

  const inactive = new TelegramManager({
    listChats: async () => [{ chatId: '100', active: false }],
  })
  assert.equal(await inactive.isAuthorized('100'), false)

  const failing = new TelegramManager({ listChats: async () => { throw new Error('db down') } })
  assert.equal(await failing.isAuthorized('100'), false)
})

test('somente chat explicitamente ativo e autorizado', async () => {
  const manager = new TelegramManager({
    listChats: async () => [{ chatId: '100', active: true }],
  })
  assert.equal(await manager.isAuthorized('100'), true)
  assert.equal(await manager.isAuthorized('101'), false)
})

test('markdown e HTML do usuario nao escapam para o parse mode do Telegram', () => {
  const manager = new TelegramManager({ listChats: async () => [] })
  const html = manager.mdToHtml('Oi <script> **mundo** [site](https://example.com?a=1&b=2)')
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /<b>mundo<\/b>/)
  assert.match(html, /href="https:\/\/example\.com\?a=1&amp;b=2"/)
})

test('envio pelo bot publica evento de sucesso e falha', async () => {
  const events = []
  const manager = new TelegramManager({ listChats: async () => [], dispatch: async (name, payload) => events.push({ name, payload }) })
  await manager.safeSend({ sendMessage: async () => ({ message_id: 8 }) }, '42', 'oi')
  await assert.rejects(manager.safeSend({ sendMessage: async () => { throw new Error('offline') } }, '42', 'oi'), /offline/)
  assert.deepEqual(events.map(item => item.name), ['telegram:message:sent', 'telegram:message:failed'])
})
