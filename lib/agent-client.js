function unwrap(payload) {
  return payload?.data ?? payload
}

export function createAgentClient({ fetchImpl = fetch, baseUrl = 'http://localhost:5040', internalToken = '' } = {}) {
  async function parseJsonResponse(response) {
    const contentType = response.headers?.get?.('content-type') || ''
    if (!contentType.includes('json') && typeof response.text === 'function') {
      await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status || 'error'} retornou ${contentType || 'conteúdo desconhecido'} em vez de JSON ou SSE`)
    }
    try {
      return await response.json()
    } catch {
      throw new Error(`HTTP ${response.status || 'error'} retornou JSON inválido`)
    }
  }

  async function request(path, options = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...(internalToken ? { Authorization: `Bearer ${internalToken}` } : {}),
        ...(options.headers || {}),
      },
    })
    const payload = await parseJsonResponse(response)
    if (!response.ok || payload?.status >= 400 || payload?.error || payload?.data?.error) {
      throw new Error(payload?.error || payload?.data?.error || `HTTP ${response.status || 'error'}`)
    }
    return unwrap(payload)
  }

  const json = (method, body) => ({
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(internalToken ? { Authorization: `Bearer ${internalToken}` } : {}),
    },
    body: JSON.stringify(body),
  })

  async function streamMessage(sessionId, message, onProgress) {
    const response = await fetchImpl(`${baseUrl}/agent/chat/stream`, json('POST', { message, session_id: sessionId }))
    if (!response.ok) {
      const contentType = response.headers?.get?.('content-type') || ''
      if (!contentType.includes('json')) {
        if (typeof response.text === 'function') await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status || 'error'} retornou ${contentType || 'conteúdo desconhecido'} em vez de JSON ou SSE`)
      }
      let payload = null
      try { payload = await response.json() } catch {}
      throw new Error(payload?.error || `HTTP ${response.status || 'error'}`)
    }

    const contentType = response.headers?.get?.('content-type') || ''
    if (!contentType.includes('text/event-stream') || !response.body?.getReader) {
      const payload = unwrap(await parseJsonResponse(response))
      return payload?.response ?? payload
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result = null
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() || ''
      for (const block of blocks) {
        let event = 'message'
        const dataLines = []
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }
        if (!dataLines.length) continue
        const data = JSON.parse(dataLines.join('\n'))
        onProgress?.({ event, data })
        if (event === 'error') throw new Error(data.error || 'Agent stream error')
        if (event === 'done') result = data.response
      }
      if (done) break
    }
    if (result === null) throw new Error('Agent stream ended without a response')
    return result
  }

  return {
    sendMessage: streamMessage,
    setSessionModel(sessionId, model) { return request('/agent/session/model', json('POST', { session_id: sessionId, model: model || null })) },
    getStatus() { return request('/agent/provider') },
    listSessions() { return request('/agent/sessions/list') },
    getHistory(sessionId) { return request(`/agent/sessions/${encodeURIComponent(sessionId)}/history`) },
    clearSession(sessionId) { return request(`/agent/sessions/${encodeURIComponent(sessionId)}/clear`) },
    cancel(sessionId) { return request('/agent/chat/cancel', json('POST', { session_id: sessionId })) },
    reconnect(sessionId, cursor = {}) {
      return request('/agent/chat/stream/reconnect', json('POST', {
        session_id: sessionId,
        epoch: cursor.epoch ?? null,
        last_event_id: cursor.lastEventId ?? null,
      }))
    },
  }
}
