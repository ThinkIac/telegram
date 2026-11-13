import { dispatchEvent } from 'logos'

import { telegramStore, telegramApi } from './service.js'
import { pollingState, startPolling, stopPolling } from './index.js'
import { inspectPublicSpecialist } from './lib/public-specialist.js'

export async function telegramStatus() {
  /**
   * @register_router api/status
   * @method GET
   */
  const status = await telegramStore.getPublicStatus()
  // The package can be hot-swapped after boot. Its polling controller is then
  // recreated without the boot hook running again, so recover it when the
  // connection screen asks for status.
  if (status.connected && !pollingState().polling) await startPolling()
  let bot = null
  if (status.connected) {
    try {
      const me = await telegramApi(await telegramStore.getToken(), 'getMe')
      bot = { id: me.id, username: me.username, first_name: me.first_name }
    } catch {}
  }
  return { ...status, ...pollingState(), bot }
}

export async function telegramSetToken(req, res) {
  /**
   * @register_router api/token
   * @method POST
   */
  try {
    const token = String(req.body?.token ?? '').trim()
    const me = await telegramApi(token, 'getMe')
    const status = await telegramStore.setToken(token)
    await dispatchEvent('telegram:token-changed', {})
    return { ...status, bot: { id: me.id, username: me.username, first_name: me.first_name } }
  } catch (error) {
    res.status(422)
    return { error: error.message }
  }
}

export function telegramGetTokenStatus() {
  /**
   * @register_router api/token
   * @method GET
   */
  return telegramStore.getPublicStatus()
}

export async function telegramDeleteToken() {
  /**
   * @register_router api/token
   * @method DELETE
   */
  await stopPolling()
  return telegramStore.clearToken()
}

export function telegramListChats() {
  /**
   * @register_router api/chats
   * @method GET
   */
  return telegramStore.listChats()
}

export async function telegramAddChat(req, res) {
  /**
   * @register_router api/chats
   * @method POST
   */
  try {
    return await telegramStore.observeChat(req.body || {})
  } catch (error) {
    res.status(422)
    return { error: error.message }
  }
}

export async function telegramDeleteChatLegacy(req, res) {
  /**
   * @register_router api/chats
   * @method DELETE
   */
  try {
    const result = await telegramStore.deleteChat(req.body?.chatId)
    if (!result.success) res.status(404)
    return result
  } catch (error) {
    res.status(422)
    return { success: false, error: error.message }
  }
}

export async function telegramToggleChat(req, res) {
  /**
   * @register_router api/chats/toggle
   * @method POST
   */
  try {
    const result = await telegramStore.toggleChat(req.body?.chatId, req.body?.active)
    if (!result.success) res.status(404)
    return result
  } catch (error) {
    res.status(422)
    return { success: false, error: error.message }
  }
}

export async function telegramDeleteChat(req, res) {
  /**
   * @register_router api/chats/:chatId
   * @method DELETE
   */
  try {
    const result = await telegramStore.deleteChat(req.params?.chatId)
    if (!result.success) res.status(404)
    return result
  } catch (error) {
    res.status(422)
    return { success: false, error: error.message }
  }
}

export async function telegramProfile(req, res) {
  /**
   * @register_router api/profile
   * @method GET
   */
  try {
    const token = await telegramStore.getToken()
    const [me, description, shortDescription] = await Promise.all([
      telegramApi(token, 'getMe'),
      telegramApi(token, 'getMyDescription'),
      telegramApi(token, 'getMyShortDescription'),
    ])
    return {
      bot: { id: me.id, username: me.username, first_name: me.first_name },
      description: description?.description || '',
      shortDescription: shortDescription?.short_description || '',
    }
  } catch (error) {
    res.status(422)
    return { error: error.message }
  }
}

export async function telegramUpdateProfile(req, res) {
  /**
   * @register_router api/profile
   * @method PATCH
   */
  try {
    const token = await telegramStore.getToken()
    const name = String(req.body?.name ?? '').trim()
    if (!name) throw new Error('Name is required')
    await Promise.all([
      telegramApi(token, 'setMyName', { name }),
      telegramApi(token, 'setMyDescription', { description: String(req.body?.description ?? '').trim() }),
      telegramApi(token, 'setMyShortDescription', { short_description: String(req.body?.shortDescription ?? '').trim() }),
    ])
    return { success: true }
  } catch (error) {
    res.status(422)
    return { error: error.message }
  }
}

export async function validateSettingsChange(changes, { current, inspect = inspectPublicSpecialist } = {}) {
  const merged = { ...current, ...changes }
  if (merged.publicEnabled) {
    if (!merged.specialistId) throw new Error('Escolha um especialista antes de ativar o atendimento público.')
    const { assessment } = await inspect(merged.specialistId)
    if (!assessment.allowed) throw new Error(assessment.reason)
  }
  for (const model of [merged.adminModel, merged.publicModel]) {
    if (!model) continue
    const { getFreshModelCatalog } = await import('../agent/llm/model_registry.js')
    const catalog = await getFreshModelCatalog()
    const access = catalog.accesses?.find(item => item.id === model)
    if (!access || !access.enabled || !access.authenticated || !access.available) {
      throw new Error('O modelo escolhido não está disponível em um provider autenticado.')
    }
  }
  return merged
}

export async function telegramModels() {
  /**
   * @register_router api/models
   * @method GET
   */
  try {
    const { getFreshModelCatalog } = await import('../agent/llm/model_registry.js')
    const catalog = await getFreshModelCatalog()
    return {
      models: (catalog.accesses || [])
        .filter(item => item.enabled && item.authenticated && item.available)
        .map(item => ({ id: item.id, name: item.name || item.model || item.id, model: item.model, provider: item.provider, providerLabel: item.metadata?.poolLabel || item.accessId || item.provider })),
    }
  } catch (error) {
    return { models: [], warning: 'Não foi possível carregar o catálogo de modelos.' }
  }
}

export function telegramGetSettings() {
  /**
   * @register_router api/settings
   * @method GET
   */
  return telegramStore.getSettings()
}

export async function telegramUpdateSettings(req, res) {
  /**
   * @register_router api/settings
   * @method PATCH
   */
  try {
    const current = await telegramStore.getSettings()
    await validateSettingsChange(req.body || {}, { current })
    if (req.body?.defaultChatId) {
      const chats = await telegramStore.listChats()
      if (!chats.some(chat => String(chat.chatId) === String(req.body.defaultChatId))) throw new Error('O destinatário padrão precisa ser um chat observado.')
    }
    return await telegramStore.setSettings(req.body || {})
  } catch (error) {
    res.status(422)
    return { error: error.message }
  }
}

export async function telegramPublicSpecialists() {
  /**
   * @register_router api/public-specialists
   * @method GET
   */
  try {
    const { listCatalog, getSpecialistById } = await import('../specialists/lib/catalog.js')
    return {
      available: true,
      specialists: listCatalog().map(item => {
        const specialist = getSpecialistById(item.id)
        const unrestricted = specialist?.toolsAllowlist === null
        return {
          ...item,
          eligible: Boolean(specialist) && !unrestricted,
          warning: unrestricted ? 'Esse especialista usa tools unrestricted e não pode atender usuários públicos.' : null,
        }
      }),
    }
  } catch {
    return { available: false, specialists: [], warning: 'O pacote Specialists não está disponível.' }
  }
}
