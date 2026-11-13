function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function markdownToHtml(input) {
  const tokens = []
  let text = String(input ?? '').replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => {
    tokens.push(`<pre>${escapeHtml(code.trim())}</pre>`)
    return `\u0000${tokens.length - 1}\u0000`
  })
  text = escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)])
}

export class TelegramManager {
  constructor({ listChats, dispatch = dispatchEvent } = {}) {
    this.listChats = listChats ?? (async () => [])
    this.dispatch = dispatch
    this.RATE_LIMIT_WINDOW_MS = 120_000
    this.RATE_LIMIT_MAX = 10
    this.MESSAGE_LIMIT = 4096
    this.DELAY_MS = 250
    this.rateLimitMap = new Map()
  }

  async isAuthorized(chatId) {
    try {
      const chats = await this.listChats()
      const chat = chats.find(item => String(item.chatId) === String(chatId))
      return chat?.active === true
    } catch (error) {
      console.warn('[Telegram] Falha ao verificar autorização:', error.message)
      return false
    }
  }

  isRateLimited(chatId) {
    const now = Date.now()
    const key = String(chatId)
    const stamps = (this.rateLimitMap.get(key) ?? []).filter(stamp => now - stamp < this.RATE_LIMIT_WINDOW_MS)
    stamps.push(now)
    this.rateLimitMap.set(key, stamps)
    return stamps.length > this.RATE_LIMIT_MAX
  }

  splitLongMessage(text) {
    if (text.length <= this.MESSAGE_LIMIT) return [text]
    const parts = []
    let remaining = text
    while (remaining.length) {
      let end = this.MESSAGE_LIMIT
      const newline = remaining.lastIndexOf('\n', end)
      if (newline > this.MESSAGE_LIMIT / 2) end = newline
      parts.push(remaining.slice(0, end))
      remaining = remaining.slice(end)
    }
    return parts
  }

  async safeSend(bot, chatId, text, options = {}) {
    if (!String(text ?? '').trim()) return null
    let result = null
    const parts = this.splitLongMessage(String(text))
    try {
      for (const part of parts) {
        result = await bot.sendMessage(chatId, part, { parse_mode: 'HTML', ...options })
        await this.dispatch('telegram:message:sent', { chatId: String(chatId), messageId: result?.message_id ? String(result.message_id) : null }).catch(() => {})
        if (parts.length > 1) await new Promise(resolve => setTimeout(resolve, this.DELAY_MS))
      }
    } catch (error) {
      await this.dispatch('telegram:message:failed', { chatId: String(chatId), error: error.message }).catch(() => {})
      throw error
    }
    return result
  }

  async safeEdit(bot, chatId, messageId, text) {
    if (!messageId || !String(text ?? '').trim()) return null
    try {
      return await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' })
    } catch (error) {
      if (!error.message?.includes('not modified')) console.warn('[Telegram] Falha ao editar status:', error.message)
      return null
    }
  }

  escapeHtml(value) { return escapeHtml(value) }
  mdToHtml(value) { return markdownToHtml(value) || 'OK' }
}
import { dispatchEvent } from 'logos'
