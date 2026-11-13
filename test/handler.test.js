import test from 'node:test'
import assert from 'node:assert/strict'

import { TelegramHandler } from '../handler.js'

function fixture({ active = true, settings = {}, specialist = null } = {}) {
  const sent = []
  const sessions = new Map()
  const chats = []
  const store = {
    async observeChat(chat) { const existing = chats.find(item => item.chatId === chat.chatId); if (existing) return existing; chats.push({ ...chat, active }); return chats.at(-1) },
    async claimMessage(chatId, messageId) { const chat = chats.find(item => item.chatId === String(chatId)); if (!chat || !messageId || chat.lastMessageId === String(messageId)) return !messageId; chat.lastMessageId = String(messageId); return true },
    async listChats() { return chats },
    async getSession(chatId) { return sessions.has(chatId) ? { sessionId: sessions.get(chatId) } : null },
    async setSession(chatId, sessionId) { sessions.set(chatId, sessionId); return { chatId, sessionId } },
    async getSettings() { return { startMessage: 'Boas-vindas', publicEnabled: false, specialistId: null, adminModel: null, publicModel: null, defaultChatId: null, ...settings } },
  }
  const events = []
  const specialists = {
    async inspect() { return specialist },
    async execute(payload) { return { text: `especialista:${payload.message}` } },
  }
  const agent = {
    async sendMessage() { return 'resposta' },
    async setSessionModel(sessionId, model) { agent.model = { sessionId, model } },
    async getStatus() { return { provider: 'teste', model: 'modelo' } },
    async listSessions() { return [{ id: 'sessao-1', created_at: new Date().toISOString() }] },
    async getHistory() { return [{ role: 'user', content: 'prévia' }] },
    async clearSession() { return true },
    async cancel() { return { success: true } },
  }
  const bot = {
    async sendMessage(chatId, text) { sent.push({ chatId, text }); return { message_id: sent.length } },
    async editMessageText() {},
    async deleteMessage() {},
  }
  return { handler: new TelegramHandler({ store, agent, specialists, dispatch: async (name, payload) => events.push({ name, payload }) }), store, bot, sent, sessions, chats, events }
}

test('primeiro contato e cadastrado desativado e nao recebe resposta', async () => {
  const { handler, bot, sent, chats } = fixture({ active: false })
  await handler.handleUpdate({ message: { text: 'oi', chat: { id: 42, first_name: 'Ana' } } }, bot)
  assert.equal(chats[0].active, false)
  assert.equal(sent.length, 0)
})

test('mantem os oito comandos publicos e o mapeamento de sessao', async () => {
  const commands = ['/start', '/help', '/sessions', '/session 1', '/new', '/clear', '/status', '/cancel']
  for (const command of commands) {
    const { handler, bot, sent } = fixture()
    await handler.handleUpdate({ message: { text: command, chat: { id: 42, first_name: 'Ana' } } }, bot)
    assert.ok(sent.length > 0, `${command} deveria responder`)
  }
})

test('mensagem comum usa a sessao mapeada e devolve a Agent', async () => {
  const { handler, bot, sent, sessions } = fixture()
  sessions.set('42', 'sessao-escolhida')
  await handler.handleUpdate({ message: { text: 'uma pergunta', chat: { id: 42, first_name: 'Ana' } } }, bot)
  assert.equal(sent.at(-1).text, 'resposta')
})

test('/start configuravel responde inclusive a chat nao ativado e toda entrada emite evento', async () => {
  const { handler, bot, sent, events } = fixture({ active: false })
  await handler.handleUpdate({ message: { message_id: 9, text: '/start', chat: { id: 42, first_name: 'Ana' }, from: { id: 42, first_name: 'Ana' } } }, bot)
  assert.equal(sent.at(-1).text, 'Boas-vindas')
  assert.equal(events[0].name, 'telegram:message:received')
  assert.equal(events[0].payload.authorized, false)
})

test('instancia legada do store nao quebra /start nem libera atendimento publico', async () => {
  const ctx = fixture({ active: false })
  delete ctx.store.getSettings

  await ctx.handler.handleUpdate({ message: { text: '/start', chat: { id: 42, first_name: 'Ana' } } }, ctx.bot)
  assert.match(ctx.sent[0].text, /Agent/)

  await ctx.handler.handleUpdate({ message: { text: 'mensagem publica', chat: { id: 42, first_name: 'Ana' } } }, ctx.bot)
  assert.equal(ctx.sent.length, 1)
})

test('mensagem sem texto de chat bloqueado tambem e observada por evento', async () => {
  const { handler, bot, sent, events } = fixture({ active: false })
  await handler.handleUpdate({ message: { message_id: 10, photo: [{}], chat: { id: 42, first_name: 'Ana' }, from: { id: 42 } } }, bot)
  assert.equal(sent.length, 0)
  assert.equal(events[0].name, 'telegram:message:received')
  assert.equal(events[0].payload.text, '')
})

test('chat publico usa somente especialista com allowlist explicita', async () => {
  const safe = fixture({ active: false, settings: { publicEnabled: true, specialistId: 'safe' }, specialist: { id: 'safe', toolsAllowlist: ['buscar'] } })
  await safe.handler.handleUpdate({ message: { text: 'oi', chat: { id: 42, first_name: 'Ana' } } }, safe.bot)
  assert.equal(safe.sent.at(-1).text, 'especialista:oi')

  const unsafe = fixture({ active: false, settings: { publicEnabled: true, specialistId: 'unsafe' }, specialist: { id: 'unsafe', toolsAllowlist: null } })
  await unsafe.handler.handleUpdate({ message: { text: 'oi', chat: { id: 42, first_name: 'Ana' } } }, unsafe.bot)
  assert.equal(unsafe.sent.length, 0)
})

test('chat ativado continua usando Agent mesmo com atendimento publico ativo', async () => {
  const ctx = fixture({ active: true, settings: { publicEnabled: true, specialistId: 'safe' }, specialist: { id: 'safe', toolsAllowlist: ['buscar'] } })
  await ctx.handler.handleUpdate({ message: { text: 'oi', chat: { id: 42, first_name: 'Ana' } } }, ctx.bot)
  assert.equal(ctx.sent.at(-1).text, 'resposta')
})

test('aplica o modelo administrativo escolhido à sessão autorizada', async () => {
  const ctx = fixture({ settings: { adminModel: 'admin@primary' } })
  await ctx.handler.handleUpdate({ message: { text: 'oi', chat: { id: 42, first_name: 'Ana' } } }, ctx.bot)
  assert.deepEqual(ctx.handler.agent.model, { sessionId: 'tg-42', model: 'admin@primary' })
})

test('envia o modelo público escolhido para o especialista', async () => {
  const ctx = fixture({ active: false, settings: { publicEnabled: true, specialistId: 'safe', publicModel: 'public@primary' }, specialist: { id: 'safe', toolsAllowlist: [] } })
  let received
  ctx.handler.specialists.execute = async payload => { received = payload; return { text: 'ok' } }
  await ctx.handler.handleUpdate({ message: { text: 'oi', chat: { id: 42, first_name: 'Ana' } } }, ctx.bot)
  assert.equal(received.model, 'public@primary')
})

test('aguarda turno ativo da Agent e envia a mensagem sem expor erro de concorrência', async () => {
  const ctx = fixture()
  let attempts = 0
  let reconnects = 0
  ctx.handler.agent.sendMessage = async (_sessionId, _message, progress) => {
    attempts += 1
    if (attempts === 1) throw new Error('Sessão "tg-42" já está processando.')
    progress({ event: 'reasoning', data: { text: 'Resposta em preparação' } })
    return 'resposta nova'
  }
  ctx.handler.agent.reconnect = async () => {
    reconnects += 1
    return { active: false, events: [] }
  }

  await ctx.handler.handleUpdate({ message: { text: 'continuar', chat: { id: 42, first_name: 'Ana' } } }, ctx.bot)

  assert.equal(reconnects, 1)
  assert.equal(attempts, 2)
  assert.equal(ctx.sent.at(-1).text, 'resposta nova')
})

test('atualiza o status por reasoning sem inundar edições do Telegram', async () => {
  const ctx = fixture()
  const edits = []
  ctx.bot.editMessageText = async text => edits.push(text)
  ctx.handler.agent.sendMessage = async (_sessionId, _message, progress) => {
    progress({ event: 'reasoning', data: { text: 'primeiro raciocínio' } })
    progress({ event: 'reasoning', data: { text: 'raciocínio mais recente' } })
    return 'resposta'
  }

  await ctx.handler.handleUpdate({ message: { text: 'oi', chat: { id: 42, first_name: 'Ana' } } }, ctx.bot)

  assert.equal(edits.length, 1)
  assert.match(edits[0], /primeiro raciocínio/)
})

test('ignora a mesma atualizacao do Telegram e nao duplica a resposta', async () => {
  const ctx = fixture()
  let calls = 0
  ctx.handler.agent.sendMessage = async () => { calls += 1; return 'resposta' }
  const update = { message: { message_id: 22, text: 'oi', chat: { id: 42, first_name: 'Ana' } } }
  await ctx.handler.handleUpdate(update, ctx.bot)
  await ctx.handler.handleUpdate(update, ctx.bot)
  assert.equal(calls, 1)
  assert.equal(ctx.sent.filter(item => item.text === 'resposta').length, 1)
})

test('mensagens durante um turno entram na fila e nao retornam erro de ocupacao', async () => {
  const ctx = fixture()
  let release
  const waiting = new Promise(resolve => { release = resolve })
  const received = []
  ctx.handler.agent.sendMessage = async (_sessionId, message) => {
    received.push(message)
    if (message === 'primeira') await waiting
    return `resposta:${message}`
  }
  const first = ctx.handler.handleUpdate({ message: { message_id: 31, text: 'primeira', chat: { id: 42, first_name: 'Ana' } } }, ctx.bot)
  await new Promise(resolve => setTimeout(resolve, 0))
  const second = ctx.handler.handleUpdate({ message: { message_id: 32, text: 'segunda', chat: { id: 42, first_name: 'Ana' } } }, ctx.bot)
  release()
  await Promise.all([first, second])
  assert.deepEqual(received, ['primeira', 'segunda'])
  assert.equal(ctx.sent.some(item => /Já existe uma tarefa/.test(item.text)), false)
})

test('lista sessoes em paginas de cinco e preserva a posicao global', async () => {
  const ctx = fixture()
  ctx.handler.agent.listSessions = async () => Array.from({ length: 7 }, (_, index) => ({ id: `sessao-${index + 1}` }))
  ctx.handler.agent.getHistory = async sessionId => [{ role: 'user', content: `prévia ${sessionId}` }]
  await ctx.handler.handleUpdate({ message: { text: '/sessions 2', chat: { id: 42, first_name: 'Ana' } } }, ctx.bot)
  const response = ctx.sent.at(-1).text
  assert.match(response, /\(2\/2\)/)
  assert.match(response, /6\. /)
  assert.match(response, /7\. /)
  assert.doesNotMatch(response, /5\. /)
})
