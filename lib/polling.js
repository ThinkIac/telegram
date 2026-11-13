import { TelegramHandler } from '../handler.js'

export class PollingController {
  constructor({ store, agent, BotClass, logger = console }) {
    this.store = store
    this.agent = agent
    this.BotClass = BotClass
    this.logger = logger
    this.bot = null
    this.handler = null
    this.error = null
  }

  state() {
    return { polling: Boolean(this.bot), error: this.error }
  }

  async stop() {
    const current = this.bot
    this.bot = null
    if (current) await current.stopPolling().catch(() => {})
  }

  async start() {
    await this.stop()
    const token = await this.store.getToken()
    if (!token) return { started: false, reason: 'missing-token' }
    if (!this.handler) this.handler = new TelegramHandler({ store: this.store, agent: this.agent })
    this.error = null
    try {
      const nextBot = new this.BotClass(token, { polling: true, onlyFirstMatch: true })
      nextBot.on('message', message => {
        this.handler.handleUpdate({ message }, nextBot).catch(error => this.logger.error('[Telegram] Mensagem:', error.message))
      })
      nextBot.on('polling_error', error => {
        this.error = error.message
        this.logger.error('[Telegram] Polling:', error.message)
      })
      this.bot = nextBot
      return { started: true }
    } catch (error) {
      this.error = error.message
      return { started: false, error: error.message }
    }
  }
}
