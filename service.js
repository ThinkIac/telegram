import { getProxy } from 'logos'

import { createTelegramStore } from './lib/store.js'
import { createAgentClient } from './lib/agent-client.js'
import { createTelegramApi } from './lib/telegram-api.js'
import { getBridgeToken } from '../agent/core/session_channel.js'

export const telegramStore = createTelegramStore(getProxy('telegram'))
export const agentClient = createAgentClient({ internalToken: getBridgeToken() })
export const telegramApi = createTelegramApi()
