import { dispatchEvent } from 'logos'

import { telegramStore, telegramApi } from './service.js'

export function createSendTelegramMessage({ store, api, dispatch = dispatchEvent }) {
  return async ({ text, chatId = null }) => {
    const body = String(text ?? '').trim()
    if (!body) throw new Error('text é obrigatório')
    const target = await store.resolveTargetChat(chatId)
    try {
      const token = await store.getToken()
      if (!token) throw new Error('O bot do Telegram não está conectado.')
      const result = await api(token, 'sendMessage', { chat_id: target, text: body })
      const payload = { success: true, chatId: target, messageId: result?.message_id ? String(result.message_id) : null }
      await dispatch('telegram:message:sent', payload).catch(() => {})
      return payload
    } catch (error) {
      await dispatch('telegram:message:failed', { chatId: target, error: error.message }).catch(() => {})
      throw error
    }
  }
}

const send = createSendTelegramMessage({ store: telegramStore, api: telegramApi })

export function telegramSendMessage({ text, chatId = null }) {
  /**
   * @register_tool telegramSendMessage
   * @description Envia uma mensagem pelo bot do Telegram. Usa o destinatário padrão ou o único chat observado quando chatId não é informado.
   * @param {string} text - Texto da mensagem
   * @param {string?} chatId - ID numérico opcional do chat destinatário
   */
  return send({ text, chatId })
}
