const API_ROOT = 'https://api.telegram.org'

export function createTelegramApi({ fetchImpl = fetch } = {}) {
  return async function telegramApi(token, method, params = {}) {
    if (!token) throw new Error('Telegram token is not configured')
    const response = await fetchImpl(`${API_ROOT}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    const payload = await response.json()
    if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram API error: ${method}`)
    return payload.result
  }
}
