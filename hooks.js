import { dispatchEvent } from 'logos'

import { telegramStore, telegramApi } from './service.js'

export async function setToken({ token }) {
  /**
   * @register_hook telegram:set-token
   */
  await telegramApi(token, 'getMe')
  const result = await telegramStore.setToken(token)
  await dispatchEvent('telegram:token-changed', {})
  return result
}

export async function getToken() {
  /**
   * @register_hook telegram:get-token
   */
  return { token: await telegramStore.getToken() }
}

export async function listChats() {
  /**
   * @register_hook telegram:list-chats
   */
  return telegramStore.listChats()
}

export async function addChat(payload) {
  /**
   * @register_hook telegram:add-chat
   */
  return telegramStore.observeChat(payload)
}

export async function deleteChat({ chatId }) {
  /**
   * @register_hook telegram:delete-chat
   */
  return telegramStore.deleteChat(chatId)
}

export async function toggleChat({ chatId, active }) {
  /**
   * @register_hook telegram:toggle-chat
   */
  return telegramStore.toggleChat(chatId, active)
}

export async function getSessionMap({ chatId }) {
  /**
   * @register_hook telegram:session-map:get
   */
  return telegramStore.getSession(chatId)
}

export async function setSessionMap({ chatId, sessionId }) {
  /**
   * @register_hook telegram:session-map:set
   */
  return telegramStore.setSession(chatId, sessionId)
}

export async function deleteSessionMap({ chatId }) {
  /**
   * @register_hook telegram:session-map:delete
   */
  return telegramStore.deleteSession(chatId)
}

export async function getSettings() {
  /**
   * @register_hook telegram:settings:get
   */
  return telegramStore.getSettings()
}

export async function updateSettings(payload) {
  /**
   * @register_hook telegram:settings:update
   */
  return telegramStore.setSettings(payload)
}

export async function notifyTokenChanged() {
  return dispatchEvent('telegram:token-changed', {})
}
