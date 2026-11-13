import test from 'node:test'
import assert from 'node:assert/strict'

import { PollingController } from '../lib/polling.js'

test('nao inicia polling sem credencial', async () => {
  const controller = new PollingController({
    store: { getToken: async () => null },
    agent: {},
    BotClass: class {},
  })
  assert.deepEqual(await controller.start(), { started: false, reason: 'missing-token' })
  assert.deepEqual(controller.state(), { polling: false, error: null })
})

test('inicia e reinicia polling encerrando a instancia anterior', async () => {
  const instances = []
  class Bot {
    constructor(token, options) { this.token = token; this.options = options; this.listeners = {}; this.stopped = false; instances.push(this) }
    on(event, listener) { this.listeners[event] = listener }
    async stopPolling() { this.stopped = true }
  }
  const controller = new PollingController({
    store: { getToken: async () => '123:secret', listChats: async () => [] },
    agent: {},
    BotClass: Bot,
  })
  assert.deepEqual(await controller.start(), { started: true })
  assert.equal(instances[0].options.polling, true)
  assert.equal(typeof instances[0].listeners.message, 'function')
  await controller.start()
  assert.equal(instances[0].stopped, true)
  assert.equal(instances.length, 2)
})
