import TelegramBot from 'node-telegram-bot-api'

import { telegramStore, agentClient } from './service.js'
import { PollingController } from './lib/polling.js'

const polling = new PollingController({ store: telegramStore, agent: agentClient, BotClass: TelegramBot })

export function pollingState() {
  return polling.state()
}

export async function stopPolling() {
  return polling.stop()
}

export async function startPolling() {
  return polling.start()
}

export function onBoot() {
  /**
   * @register_hook boot
   */
  return startPolling()
}

export function onTokenChanged() {
  /**
   * @register_hook telegram:token-changed
   */
  return startPolling()
}
