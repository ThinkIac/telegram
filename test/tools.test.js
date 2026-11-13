import test from 'node:test'
import assert from 'node:assert/strict'

import { createSendTelegramMessage } from '../tools.js'

test('tool usa chat explicito ou resolucao segura do padrao e emite eventos', async () => {
  const calls = []
  const events = []
  const send = createSendTelegramMessage({
    store: { getToken: async () => 'token', resolveTargetChat: async () => '42' },
    api: async (token, method, body) => { calls.push({ token, method, body }); return { message_id: 7 } },
    dispatch: async (name, payload) => events.push({ name, payload }),
  })
  const result = await send({ text: 'Olá' })
  assert.equal(calls[0].body.chat_id, '42')
  assert.equal(result.messageId, '7')
  assert.equal(events[0].name, 'telegram:message:sent')
})

test('tool emite falha sem expor token', async () => {
  const events = []
  const send = createSendTelegramMessage({
    store: { getToken: async () => 'super-secret', resolveTargetChat: async () => '42' },
    api: async () => { throw new Error('offline') },
    dispatch: async (name, payload) => events.push({ name, payload }),
  })
  await assert.rejects(send({ text: 'Olá' }), /offline/)
  assert.equal(events[0].name, 'telegram:message:failed')
  assert.doesNotMatch(JSON.stringify(events), /super-secret/)
})
