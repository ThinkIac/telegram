import test from 'node:test'
import assert from 'node:assert/strict'

import { createAgentClient } from '../lib/agent-client.js'

test('envia mensagem pelo contrato HTTP atual da Agent e desembrulha a resposta', async () => {
  const calls = []
  const client = createAgentClient({
    baseUrl: 'http://runtime.test',
    internalToken: 'runtime-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return { ok: true, json: async () => ({ data: { response: 'resposta', session_id: 'tg-1' } }) }
    },
  })

  assert.equal(await client.sendMessage('tg-1', 'ola'), 'resposta')
  assert.equal(calls[0].url, 'http://runtime.test/agent/chat/stream')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer runtime-secret')
  assert.deepEqual(JSON.parse(calls[0].options.body), { message: 'ola', session_id: 'tg-1' })
})

test('descreve resposta inesperada sem tentar interpretar HTML como JSON', async () => {
  const client = createAgentClient({
    fetchImpl: async () => ({
      ok: false,
      status: 302,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => '<html>Login</html>',
    }),
  })

  await assert.rejects(
    client.sendMessage('tg-1', 'ola'),
    /HTTP 302 retornou text\/html.* em vez de JSON ou SSE/,
  )
})

test('usa contratos atuais para limpar, cancelar e consultar status', async () => {
  const calls = []
  const client = createAgentClient({
    baseUrl: 'http://runtime.test',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options })
      if (url.endsWith('/provider')) return { ok: true, json: async () => ({ data: { provider: 'p', model: 'm' } }) }
      return { ok: true, json: async () => ({ success: true }) }
    },
  })

  assert.deepEqual(await client.getStatus(), { provider: 'p', model: 'm' })
  await client.clearSession('tg-1')
  await client.cancel('tg-1')
  assert.equal(calls[1].url, 'http://runtime.test/agent/sessions/tg-1/clear')
  assert.equal(calls[2].url, 'http://runtime.test/agent/chat/cancel')
})

test('envia a credencial interna também nos comandos auxiliares', async () => {
  const calls = []
  const client = createAgentClient({
    internalToken: 'runtime-secret',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options })
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: {} }) }
    },
  })

  await client.getStatus()
  await client.listSessions()
  await client.clearSession('tg-1')
  await client.cancel('tg-1')
  assert.ok(calls.every(call => call.options.headers?.Authorization === 'Bearer runtime-secret'))
})

test('consome eventos SSE de progresso e resposta final', async () => {
  const encoder = new TextEncoder()
  const chunks = [
    'event: step\ndata: {"label":"Consultando"}\n\n',
    'event: done\ndata: {"response":"concluido"}\n\n',
  ]
  let index = 0
  const progress = []
  const client = createAgentClient({
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => 'text/event-stream' },
      body: { getReader: () => ({ read: async () => index < chunks.length ? { value: encoder.encode(chunks[index++]), done: false } : { done: true } }) },
    }),
  })
  const result = await client.sendMessage('tg-1', 'ola', event => progress.push(event))
  assert.equal(result, 'concluido')
  assert.deepEqual(progress.map(item => item.event), ['step', 'done'])
})

test('consulta o estado de um stream para retomar um turno ativo', async () => {
  const calls = []
  const client = createAgentClient({
    baseUrl: 'http://runtime.test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: { active: true, epoch: 2, events: [] } }) }
    },
  })

  assert.deepEqual(await client.reconnect('tg-1', { epoch: 1, lastEventId: 9 }), { active: true, epoch: 2, events: [] })
  assert.equal(calls[0].url, 'http://runtime.test/agent/chat/stream/reconnect')
  assert.deepEqual(JSON.parse(calls[0].options.body), { session_id: 'tg-1', epoch: 1, last_event_id: 9 })
})
