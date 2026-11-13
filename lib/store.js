function normalizeChatId(chatId) {
  const value = String(chatId ?? '').trim()
  if (!/^-?\d+$/.test(value)) throw new Error('Invalid chatId')
  return value
}

function maskToken(token) {
  if (!token) return null
  const value = String(token)
  const prefix = value.includes(':') ? value.slice(0, value.indexOf(':')) : value.slice(0, 4)
  return `${prefix}:...${value.slice(-4)}`
}

export const DEFAULT_START_MESSAGE = 'Olá! Sou a <b>Agent</b>, conectada pelo Telegram.\n\n/help lista os comandos.'

export function createTelegramStore(db) {
  async function getCredential() {
    return (await db.credential.query({}, { limit: 1 }))[0] ?? null
  }

  async function getSetting() {
    return (await db.setting.query({}, { limit: 1 }))[0] ?? null
  }

  return {
    async getToken() {
      return (await getCredential())?.token ?? null
    },

    async setToken(token) {
      const value = String(token ?? '').trim()
      if (!value) throw new Error('Token is required')
      const existing = await getCredential()
      if (existing) existing.token = value
      else await db.credential.push({ token: value })
      return { connected: true, maskedToken: maskToken(value) }
    },

    async clearToken() {
      const existing = await getCredential()
      if (existing) await db.credential.delete(existing.id)
      return { connected: false, maskedToken: null }
    },

    async getPublicStatus() {
      const token = await this.getToken()
      return { connected: Boolean(token), maskedToken: maskToken(token) }
    },

    async listChats() {
      return db.chat.query()
    },

    async getSettings() {
      const row = await getSetting()
      return {
        startMessage: row?.startMessage || DEFAULT_START_MESSAGE,
        publicEnabled: row?.publicEnabled === true,
        specialistId: row?.specialistId || null,
        adminModel: row?.adminModel || null,
        publicModel: row?.publicModel || null,
        defaultChatId: row?.defaultChatId || null,
      }
    },

    async setSettings(changes = {}) {
      const current = await this.getSettings()
      const next = {
        startMessage: changes.startMessage === undefined ? current.startMessage : String(changes.startMessage || '').trim(),
        publicEnabled: changes.publicEnabled === undefined ? current.publicEnabled : changes.publicEnabled === true,
        specialistId: changes.specialistId === undefined ? current.specialistId : (changes.specialistId ? String(changes.specialistId) : null),
        adminModel: changes.adminModel === undefined ? current.adminModel : (changes.adminModel ? String(changes.adminModel) : null),
        publicModel: changes.publicModel === undefined ? current.publicModel : (changes.publicModel ? String(changes.publicModel) : null),
        defaultChatId: changes.defaultChatId === undefined ? current.defaultChatId : (changes.defaultChatId ? normalizeChatId(changes.defaultChatId) : null),
      }
      if (!next.startMessage) throw new Error('A mensagem de /start é obrigatória.')
      const row = await getSetting()
      if (row) Object.assign(row, next)
      else await db.setting.push(next)
      return next
    },

    async resolveTargetChat(explicitChatId = null) {
      if (explicitChatId !== null && explicitChatId !== undefined && String(explicitChatId).trim()) return normalizeChatId(explicitChatId)
      const settings = await this.getSettings()
      if (settings.defaultChatId) return settings.defaultChatId
      const chats = await this.listChats()
      if (chats.length === 1) return String(chats[0].chatId)
      if (!chats.length) throw new Error('Nenhum chat do Telegram foi observado.')
      throw new Error('Há mais de um chat e nenhum destinatário padrão foi definido; informe chatId.')
    },

    async observeChat({ chatId, name, username }) {
      const normalized = normalizeChatId(chatId)
      const existing = (await db.chat.query({ chatId: normalized }))[0]
      if (existing) {
        existing.name = String(name || existing.name || normalized)
        existing.username = username ? String(username) : null
        return existing
      }
      return db.chat.push({
        chatId: normalized,
        name: String(name || normalized),
        username: username ? String(username) : null,
        active: false,
      })
    },

    async claimMessage(chatId, messageId) {
      if (messageId === null || messageId === undefined || String(messageId).trim() === '') return true
      const normalized = normalizeChatId(chatId)
      const value = String(messageId)
      const chat = (await db.chat.query({ chatId: normalized }))[0]
      if (!chat || chat.lastMessageId === value) return false
      chat.lastMessageId = value
      return true
    },

    async toggleChat(chatId, active) {
      const normalized = normalizeChatId(chatId)
      const existing = (await db.chat.query({ chatId: normalized }))[0]
      if (!existing) return { success: false, error: 'Chat not found' }
      existing.active = active === true || active === 'true' || active === 1
      return { success: true, active: existing.active }
    },

    async deleteChat(chatId) {
      const normalized = normalizeChatId(chatId)
      const existing = (await db.chat.query({ chatId: normalized }))[0]
      if (!existing) return { success: false, error: 'Chat not found' }
      await db.chat.delete(existing.id)
      return { success: true }
    },

    async getSession(chatId) {
      const normalized = normalizeChatId(chatId)
      return (await db.sessionmap.query({ chatId: normalized }))[0] ?? null
    },

    async setSession(chatId, sessionId) {
      const normalized = normalizeChatId(chatId)
      const value = String(sessionId ?? '').trim()
      if (!value) throw new Error('sessionId is required')
      const existing = (await db.sessionmap.query({ chatId: normalized }))[0]
      if (existing) {
        existing.sessionId = value
        existing.updatedAt = new Date()
        return existing
      }
      return db.sessionmap.push({ chatId: normalized, sessionId: value })
    },

    async deleteSession(chatId) {
      const existing = await this.getSession(chatId)
      if (!existing) return { success: false, error: 'Not found' }
      await db.sessionmap.delete(existing.id)
      return { success: true }
    },
  }
}

export { maskToken, normalizeChatId }
