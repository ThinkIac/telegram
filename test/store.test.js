import test from 'node:test'
import assert from 'node:assert/strict'

import { createTelegramStore } from '../lib/store.js'

function collection(initial = []) {
  const rows = initial
  return {
    async query(where = {}) { return rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value)) },
    async push(data) { const row = { id: String(rows.length + 1), ...data }; rows.push(row); return row },
    async delete(id) { const index = rows.findIndex(row => row.id === id); if (index >= 0) rows.splice(index, 1) },
  }
}

function database() {
  return { credential: collection(), chat: collection(), sessionmap: collection(), setting: collection() }
}

test('status nunca devolve o token e credencial pode ser removida', async () => {
  const db = database()
  const store = createTelegramStore(db)
  await store.setToken('123:secret')
  assert.deepEqual(await store.getPublicStatus(), { connected: true, maskedToken: '123:...cret' })
  assert.equal('token' in await store.getPublicStatus(), false)
  await store.clearToken()
  assert.deepEqual(await store.getPublicStatus(), { connected: false, maskedToken: null })
})

test('chat observado nasce inativo e nova observacao nao o reativa', async () => {
  const db = database()
  const store = createTelegramStore(db)
  const first = await store.observeChat({ chatId: '42', name: 'Ana', username: 'ana' })
  assert.equal(first.active, false)
  first.active = false
  const again = await store.observeChat({ chatId: '42', name: 'Ana B', username: 'ana_b' })
  assert.equal(again.active, false)
  assert.equal(again.name, 'Ana B')
})

test('configuracao publica tem defaults seguros e persiste mensagem, especialista e chat padrao', async () => {
  const store = createTelegramStore(database())
  assert.deepEqual(await store.getSettings(), {
    startMessage: 'Olá! Sou a <b>Agent</b>, conectada pelo Telegram.\n\n/help lista os comandos.',
    publicEnabled: false,
    specialistId: null,
    adminModel: null,
    publicModel: null,
    defaultChatId: null,
  })
  const saved = await store.setSettings({
    startMessage: 'Bem-vindo', publicEnabled: true, specialistId: 'safe', adminModel: 'admin@primary', publicModel: 'public@primary', defaultChatId: '42',
  })
  assert.equal(saved.startMessage, 'Bem-vindo')
  assert.equal(saved.publicEnabled, true)
  assert.equal(saved.specialistId, 'safe')
  assert.equal(saved.adminModel, 'admin@primary')
  assert.equal(saved.publicModel, 'public@primary')
  assert.equal(saved.defaultChatId, '42')
})

test('resolve destinatario automaticamente apenas quando nao ha ambiguidade', async () => {
  const db = database()
  const store = createTelegramStore(db)
  await store.observeChat({ chatId: '42', name: 'Ana' })
  assert.equal(await store.resolveTargetChat(), '42')
  await store.observeChat({ chatId: '43', name: 'Bia' })
  await assert.rejects(store.resolveTargetChat(), /mais de um chat/i)
  await store.setSettings({ defaultChatId: '43' })
  assert.equal(await store.resolveTargetChat(), '43')
})
