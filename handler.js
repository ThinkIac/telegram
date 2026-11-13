import { TelegramManager } from './manager.js'
import { dispatchEvent } from 'logos'
import { assessPublicSpecialist, createSpecialistAdapter } from './lib/public-specialist.js'
import { DEFAULT_START_MESSAGE } from './lib/store.js'

const commandName = text => text.split(/\s+/, 1)[0].split('@', 1)[0].toLowerCase()
const SESSION_PAGE_SIZE = 5

// A package hot swap can leave the former polling listener alive briefly. Keep
// this guard outside the module instance so both listeners ignore a repeated
// Telegram update before any async work begins.
const deliveryGuard = globalThis[Symbol.for('thinkiac.telegram.delivery-guard')] ??= new Map()

function claimDelivery(chatId, messageId) {
  if (messageId === null || messageId === undefined) return true
  const key = `${chatId}:${messageId}`
  if (deliveryGuard.has(key)) return false
  deliveryGuard.set(key, Date.now())
  if (deliveryGuard.size > 2_000) {
    const expiresBefore = Date.now() - 3_600_000
    for (const [storedKey, createdAt] of deliveryGuard) {
      if (createdAt >= expiresBefore && deliveryGuard.size <= 1_500) break
      deliveryGuard.delete(storedKey)
    }
  }
  return true
}

export class TelegramHandler {
  constructor({ store, agent, manager, specialists = undefined, dispatch = dispatchEvent } = {}) {
    if (!store || !agent) throw new Error('TelegramHandler requires store and agent')
    this.store = store
    this.agent = agent
    this.manager = manager ?? new TelegramManager({ listChats: () => store.listChats(), dispatch })
    this.specialists = specialists
    this.dispatch = dispatch
    this.activeRuns = new Map()
    this.AGENT_TIMEOUT_MS = 5_000_000
    this.RECONNECT_INTERVAL_MS = 1_500
    this.STATUS_UPDATE_INTERVAL_MS = 1_200
  }

  async currentSession(chatId) {
    return (await this.store.getSession(chatId))?.sessionId || `tg-${chatId}`
  }

  async settings() {
    if (typeof this.store.getSettings === 'function') return this.store.getSettings()
    return {
      startMessage: DEFAULT_START_MESSAGE,
      publicEnabled: false,
      specialistId: null,
      adminModel: null,
      publicModel: null,
      defaultChatId: null,
    }
  }

  async sessionsWithPreview() {
    try {
      const sessions = await this.agent.listSessions()
      const visible = Array.isArray(sessions) ? sessions.filter(session => !session.id?.startsWith('worker-')) : []
      return Promise.all(visible.map(async session => {
        let preview = session.title || session.summary || 'Sem mensagens'
        try {
          const history = await this.agent.getHistory(session.id)
          const lastUser = [...(Array.isArray(history) ? history : [])].reverse().find(item => item.role === 'user')
          if (lastUser?.content) preview = String(lastUser.content).slice(0, 60)
        } catch {}
        return { ...session, preview }
      }))
    } catch {
      return []
    }
  }

  async runCommand(command, chatId, sessionId, text) {
    if (command === '/start') return (await this.settings()).startMessage
    if (command === '/help') return '<b>Agent: comandos</b>\n\n/sessions [página] lista 5 sessões por página\n/session &lt;n&gt; troca de sessão\n/new cria nova sessão\n/clear limpa o histórico\n/status mostra o modelo atual\n/cancel interrompe a execução'
    if (command === '/clear') {
      await this.agent.clearSession(sessionId)
      return 'Sessão limpa.'
    }
    if (command === '/cancel') {
      const run = this.activeRuns.get(String(chatId))
      if (!run) return 'Nenhuma tarefa em execução.'
      run.cancelled = true
      await this.agent.cancel(sessionId).catch(() => {})
      if (run.statusId) await run.bot.deleteMessage(chatId, run.statusId).catch(() => {})
      return 'Tarefa cancelada.'
    }
    if (command === '/status') {
      const status = await this.agent.getStatus()
      return [`<b>Agent online</b>`, `Provider: <code>${this.manager.escapeHtml(status?.provider || 'unknown')}</code>`, `Modelo: <code>${this.manager.escapeHtml(status?.model || 'unknown')}</code>`, `Sessão: <code>${this.manager.escapeHtml(sessionId)}</code>`].join('\n')
    }
    if (command === '/new') {
      const next = `tg-${chatId}-${Date.now()}`
      await this.store.setSession(chatId, next)
      return `Nova sessão criada.\n<code>${this.manager.escapeHtml(next)}</code>`
    }
    if (command === '/sessions') {
      const sessions = await this.sessionsWithPreview()
      if (!sessions.length) return 'Nenhuma sessão disponível.'
      const pageArg = Number.parseInt(text.split(/\s+/)[1], 10)
      const totalPages = Math.ceil(sessions.length / SESSION_PAGE_SIZE)
      const page = Number.isInteger(pageArg) && pageArg > 0 ? Math.min(pageArg, totalPages) : 1
      const start = (page - 1) * SESSION_PAGE_SIZE
      const lines = [`<b>Sessões disponíveis</b> (${page}/${totalPages})`]
      sessions.slice(start, start + SESSION_PAGE_SIZE).forEach((session, index) => {
        const marker = session.id === sessionId ? '* ' : ''
        lines.push(`${start + index + 1}. ${marker}<code>${this.manager.escapeHtml(session.id)}</code> ${this.manager.escapeHtml(session.preview)}`)
      })
      lines.push(`\nUse /session &lt;n&gt; para trocar.${page < totalPages ? `\n/sessions ${page + 1} para próxima página.` : ''}`)
      return lines.join('\n')
    }
    if (command === '/session') {
      const arg = text.split(/\s+/)[1]?.toLowerCase()
      if (!arg) return `Sessão atual: <code>${this.manager.escapeHtml(sessionId)}</code>\nUse /session &lt;n&gt; para trocar.`
      if (arg === 'default' || arg === 'reset') {
        const next = `tg-${chatId}`
        await this.store.setSession(chatId, next)
        return `Sessão padrão ativada: <code>${this.manager.escapeHtml(next)}</code>`
      }
      const position = Number.parseInt(arg, 10)
      if (!Number.isInteger(position) || position < 1) return 'Use /session &lt;número&gt; ou /session default.'
      const sessions = await this.sessionsWithPreview()
      const selected = sessions[position - 1]
      if (!selected) return `Sessão #${position} não encontrada. Use /sessions para listar.`
      await this.store.setSession(chatId, selected.id)
      return `Sessão ativada: <code>${this.manager.escapeHtml(selected.id)}</code>\n${this.manager.escapeHtml(selected.preview)}`
    }
    return null
  }

  async handleUpdate(update, bot) {
    const message = update?.message
    if (!message?.chat?.id || !bot) return
    const chatId = String(message.chat.id)
    const messageId = message.message_id ? String(message.message_id) : null
    if (!claimDelivery(chatId, messageId)) return
    await this.store.observeChat({
      chatId,
      name: message.chat.title || message.chat.first_name || message.from?.first_name || chatId,
      username: message.chat.username || message.from?.username || null,
    })
    if (typeof this.store.claimMessage === 'function' && !(await this.store.claimMessage(chatId, messageId))) return
    const text = String(message.text ?? message.caption ?? '').trim()
    const sessionId = await this.currentSession(chatId)
    const command = commandName(text)
    const authorized = await this.manager.isAuthorized(chatId)
    await this.dispatch('telegram:message:received', {
      chatId,
      messageId,
      text,
      command: command.startsWith('/') ? command : null,
      authorized,
      sender: {
        id: message.from?.id ? String(message.from.id) : null,
        name: message.from?.first_name || message.chat.first_name || null,
        username: message.from?.username || message.chat.username || null,
      },
    }).catch(() => {})
    if (!text) return
    if (command === '/start') {
      const response = await this.runCommand(command, chatId, sessionId, text)
      return this.manager.safeSend(bot, chatId, response)
    }
    if (!authorized) return this.executePublicSpecialist(bot, chatId, text, message)
    if (this.manager.isRateLimited(chatId)) return this.manager.safeSend(bot, chatId, 'Muitas mensagens. Aguarde um pouco.')

    const known = ['/start', '/help', '/sessions', '/session', '/new', '/clear', '/status', '/cancel']
    if (known.includes(command)) {
      const response = await this.runCommand(command, chatId, sessionId, text)
      return this.manager.safeSend(bot, chatId, response)
    }
    return this.executeAgent(bot, chatId, sessionId, text)
  }

  async executePublicSpecialist(bot, chatId, text, message) {
    const settings = await this.settings()
    if (!settings.publicEnabled || !settings.specialistId) return
    const adapter = this.specialists === undefined ? await createSpecialistAdapter() : this.specialists
    if (!adapter) return
    const specialist = await adapter.inspect(settings.specialistId)
    if (!assessPublicSpecialist(specialist).allowed) return
    if (this.manager.isRateLimited(chatId)) return this.manager.safeSend(bot, chatId, 'Muitas mensagens. Aguarde um pouco.')
    try {
      const result = await adapter.execute({
        specialist,
        message: text,
        chatId,
        sender: { id: message.from?.id ? String(message.from.id) : null, name: message.from?.first_name || null, username: message.from?.username || null },
        model: settings.publicModel || null,
      })
      const response = result?.text || result?.response || result?.output
      if (response) return this.manager.safeSend(bot, chatId, this.manager.mdToHtml(response))
    } catch (error) {
      console.error('[Telegram] Especialista público:', error.message)
    }
  }

  async executeAgent(bot, chatId, sessionId, text) {
    const key = String(chatId)
    const previous = this.activeRuns.get(key)
    if (previous) {
      previous.queued = (previous.queued || 0) + 1
      this.updateStatus(previous, chatId, 'step', { label: `Mensagem recebida. ${previous.queued} na fila após a etapa atual.` })
      await previous.done.catch(() => {})
      return this.executeAgent(bot, chatId, sessionId, text)
    }
    const run = { cancelled: false, bot, statusId: null, lastStatusAt: 0, pendingStatus: null, statusTimer: null, queued: 0, done: null }
    this.activeRuns.set(key, run)
    run.done = this.executeAgentRun(run, bot, chatId, sessionId, text)
    return run.done
  }

  async executeAgentRun(run, bot, chatId, sessionId, text) {
    const status = await this.manager.safeSend(bot, chatId, 'Processando...')
    run.statusId = status?.message_id || null
    let timeoutId
    try {
      const settings = await this.settings()
      if (typeof this.agent.setSessionModel === 'function') await this.agent.setSessionModel(sessionId, settings.adminModel || null)
      const onProgress = ({ event, data }) => this.updateStatus(run, chatId, event, data)
      const send = () => this.agent.sendMessage(sessionId, text, onProgress)
      const response = await Promise.race([
        this.sendAfterActiveTurn(sessionId, send, onProgress),
        new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('TIMEOUT')), this.AGENT_TIMEOUT_MS) }),
      ])
      if (run.cancelled) return
      if (status?.message_id) await bot.deleteMessage(chatId, status.message_id).catch(() => {})
      return this.manager.safeSend(bot, chatId, this.manager.mdToHtml(response))
    } catch (error) {
      const message = error.message === 'TIMEOUT' ? 'Tempo limite excedido.' : `Erro: ${this.manager.escapeHtml(error.message)}`
      return this.manager.safeEdit(bot, chatId, status?.message_id, message)
    } finally {
      clearTimeout(timeoutId)
      clearTimeout(run.statusTimer)
      this.activeRuns.delete(String(chatId))
    }
  }

  updateStatus(run, chatId, event, data) {
    if (run.cancelled || !run.statusId) return
    let text = null
    if (event === 'reasoning' && data?.text) text = `Pensando\n\n${this.manager.escapeHtml(String(data.text).slice(-700))}`
    if (event === 'step' && data?.label) text = `Executando\n\n${this.manager.escapeHtml(String(data.label).slice(0, 700))}`
    if (!text) return
    run.pendingStatus = text
    const now = Date.now()
    const flush = () => {
      run.statusTimer = null
      if (!run.pendingStatus || run.cancelled) return
      const next = run.pendingStatus
      run.pendingStatus = null
      run.lastStatusAt = Date.now()
      this.manager.safeEdit(run.bot, chatId, run.statusId, next)
    }
    if (now - run.lastStatusAt >= this.STATUS_UPDATE_INTERVAL_MS) flush()
    else if (!run.statusTimer) run.statusTimer = setTimeout(flush, this.STATUS_UPDATE_INTERVAL_MS - (now - run.lastStatusAt))
  }

  async sendAfterActiveTurn(sessionId, send, onProgress) {
    try {
      return await send()
    } catch (error) {
      if (!/j[aá] est[aá] processando|already processing/i.test(error.message) || typeof this.agent.reconnect !== 'function') throw error
      onProgress({ event: 'step', data: { label: 'Há uma tarefa anterior em andamento. Aguardando para enviar esta mensagem...' } })
      let cursor = {}
      while (true) {
        const state = await this.agent.reconnect(sessionId, cursor)
        for (const item of state?.events || []) {
          cursor = { epoch: state.epoch ?? cursor.epoch, lastEventId: item.id ?? cursor.lastEventId }
          onProgress({ event: item.event, data: item.data || {} })
        }
        if (!state?.active) return send()
        await new Promise(resolve => setTimeout(resolve, this.RECONNECT_INTERVAL_MS))
      }
    }
  }
}
