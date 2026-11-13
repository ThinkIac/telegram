<script>
  import { onMount } from 'svelte'

  let theme = 'dark'
  let tab = 'connection'
  let loading = true
  let busy = false
  let message = ''
  let error = ''
  let connected = false
  let masked = ''
  let polling = false
  let pollingError = ''
  let bot = null
  let tokenInput = ''
  let chats = []
  let specialists = []
  let specialistsAvailable = false
  let models = []
  let modelsError = ''
  let settings = { startMessage: '', publicEnabled: false, specialistId: '', adminModel: '', publicModel: '', defaultChatId: '' }
  let search = ''
  let profile = { name: '', description: '', shortDescription: '' }

  $: filteredChats = chats.filter(chat => `${chat.name} ${chat.username || ''} ${chat.chatId}`.toLowerCase().includes(search.toLowerCase()))
  $: activeCount = chats.filter(chat => chat.active).length

  async function api(path, options = {}) {
    const response = await fetch(`/telegram/api/${path}`, {
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
    const payload = await response.json()
    if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`)
    return payload
  }

  async function loadStatus() {
    const status = await api('status')
    connected = status.connected
    masked = status.maskedToken || ''
    polling = status.polling
    pollingError = status.error || ''
    bot = status.bot
  }

  async function loadChats() {
    chats = await api('chats')
  }

  async function loadSettings() {
    const [saved, catalog, modelCatalog] = await Promise.all([api('settings'), api('public-specialists'), api('models')])
    settings = { ...saved, specialistId: saved.specialistId || '', adminModel: saved.adminModel || '', publicModel: saved.publicModel || '', defaultChatId: saved.defaultChatId || '' }
    specialistsAvailable = catalog.available === true
    specialists = catalog.specialists || []
    models = modelCatalog.models || []
    modelsError = modelCatalog.warning || ''
  }

  async function loadProfile() {
    const result = await api('profile')
    bot = result.bot
    profile = {
      name: result.bot?.first_name || '',
      description: result.description || '',
      shortDescription: result.shortDescription || '',
    }
  }

  async function refresh() {
    loading = true
    error = ''
    try {
      await loadStatus()
      if (connected) await Promise.all([loadChats(), loadProfile(), loadSettings()])
    } catch (cause) {
      error = cause.message
    } finally {
      loading = false
    }
  }

  async function connect() {
    if (!tokenInput.trim()) return
    busy = true
    error = ''
    message = ''
    try {
      await api('token', { method: 'POST', body: { token: tokenInput.trim() } })
      tokenInput = ''
      message = 'Bot conectado e polling iniciado.'
      await refresh()
      tab = 'profile'
    } catch (cause) {
      error = cause.message
    } finally {
      busy = false
    }
  }

  async function disconnect() {
    busy = true
    error = ''
    try {
      await api('token', { method: 'DELETE' })
      connected = false
      polling = false
      masked = ''
      bot = null
      chats = []
      tab = 'connection'
      message = 'Bot desconectado. A credencial foi removida.'
    } catch (cause) {
      error = cause.message
    } finally {
      busy = false
    }
  }

  async function toggleChat(chat) {
    const previous = chat.active
    chats = chats.map(item => item.chatId === chat.chatId ? { ...item, active: !previous } : item)
    try {
      const result = await api('chats/toggle', { method: 'POST', body: { chatId: chat.chatId, active: !previous } })
      chats = chats.map(item => item.chatId === chat.chatId ? { ...item, active: result.active } : item)
    } catch (cause) {
      chats = chats.map(item => item.chatId === chat.chatId ? { ...item, active: previous } : item)
      error = cause.message
    }
  }

  async function saveProfile() {
    busy = true
    error = ''
    message = ''
    try {
      await api('profile', { method: 'PATCH', body: profile })
      message = 'Perfil atualizado.'
      await loadProfile()
    } catch (cause) {
      error = cause.message
    } finally {
      busy = false
    }
  }

  async function saveSettings() {
    busy = true
    error = ''
    message = ''
    try {
      settings = await api('settings', { method: 'PATCH', body: settings })
      settings = { ...settings, specialistId: settings.specialistId || '', adminModel: settings.adminModel || '', publicModel: settings.publicModel || '', defaultChatId: settings.defaultChatId || '' }
      message = 'Configuração de atendimento salva.'
    } catch (cause) {
      error = cause.message
    } finally {
      busy = false
    }
  }

  onMount(() => {
    const readTheme = () => { theme = localStorage.getItem('think:theme') === 'light' ? 'light' : 'dark' }
    const onStorage = event => { if (event.key === 'think:theme') readTheme() }
    readTheme()
    window.addEventListener('storage', onStorage)
    refresh()
    return () => window.removeEventListener('storage', onStorage)
  })
</script>

<main class="page" data-theme={theme} aria-busy={loading || busy}>
  <section class="shell" aria-labelledby="telegram-title">
    <header class="topbar">
      <h1 id="telegram-title">Telegram</h1>
      <span class="bot-name">{bot ? `@${bot.username || bot.first_name}` : 'Canal da Agent'}</span>
      <span class:online={connected && polling} class="status">{connected && polling ? 'Online' : 'Offline'}</span>
    </header>

    <nav aria-label="Seções do Telegram">
      <button class:active={tab === 'connection'} aria-selected={tab === 'connection'} on:click={() => tab = 'connection'}>Conexão</button>
      <button class:active={tab === 'profile'} aria-selected={tab === 'profile'} disabled={!connected} on:click={() => tab = 'profile'}>Perfil</button>
      <button class:active={tab === 'chats'} aria-selected={tab === 'chats'} disabled={!connected} on:click={() => tab = 'chats'}>Chats {activeCount ? `(${activeCount})` : ''}</button>
      <button class:active={tab === 'automation'} aria-selected={tab === 'automation'} disabled={!connected} on:click={() => tab = 'automation'}>Atendimento</button>
    </nav>

    {#if error}<div class="notice" role="alert">{error}</div>{/if}
    {#if message}<div class="notice" role="status">{message}</div>{/if}
    {#if pollingError}<div class="notice" role="alert">Falha no polling: {pollingError}</div>{/if}

    <div class="content">
      {#if loading}
        <div class="empty">Carregando configuração...</div>
      {:else if tab === 'connection'}
        <section class="card" aria-labelledby="connection-title">
          <h2 id="connection-title">Credencial do bot</h2>
          {#if connected}
            <p class="lead">Token salvo somente no backend</p>
            <code>{masked}</code>
            <button class="danger" disabled={busy} on:click={disconnect}>Desconectar e apagar token</button>
          {:else}
            <label for="bot-token">Token fornecido pelo BotFather</label>
            <input id="bot-token" type="password" autocomplete="off" bind:value={tokenInput} on:keydown={event => event.key === 'Enter' && connect()} />
            <p class="hint">O token é validado pelo backend e nunca volta para esta tela.</p>
            <button class="primary" disabled={busy || !tokenInput.trim()} on:click={connect}>{busy ? 'Validando...' : 'Conectar bot'}</button>
          {/if}
        </section>
      {:else if tab === 'profile'}
        <section class="card" aria-labelledby="profile-title">
          <h2 id="profile-title">Perfil público</h2>
          <label for="bot-name">Nome</label>
          <input id="bot-name" maxlength="64" bind:value={profile.name} />
          <label for="bot-description">Descrição</label>
          <textarea id="bot-description" maxlength="512" rows="4" bind:value={profile.description}></textarea>
          <label for="bot-about">Sobre</label>
          <input id="bot-about" maxlength="120" bind:value={profile.shortDescription} />
          <button class="primary" disabled={busy || !profile.name.trim()} on:click={saveProfile}>{busy ? 'Salvando...' : 'Salvar perfil'}</button>
        </section>
      {:else if tab === 'chats'}
        <section class="card" aria-labelledby="chats-title">
          <div class="title-row">
            <div><h2 id="chats-title">Chats observados</h2><p class="hint">Chats novos começam bloqueados.</p></div>
            <button class="icon-button" aria-label="Atualizar chats" on:click={loadChats}>
              <svg viewBox="0 0 24 24"><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 11M5.5 15A7 7 0 0 0 18 17.5l2-4.5"/></svg>
            </button>
          </div>
          <label for="chat-search">Buscar</label>
          <input id="chat-search" type="search" bind:value={search} placeholder="Nome, usuário ou ID" />
          <div class="chat-list">
            {#each filteredChats as chat (chat.chatId)}
              <article class="chat-row">
                <div><strong>{chat.name}</strong><small>{chat.username ? `@${chat.username} · ` : ''}{chat.chatId}</small></div>
                <button class:enabled={chat.active} class="toggle" role="switch" aria-checked={chat.active} aria-label={`${chat.active ? 'Desativar' : 'Ativar'} ${chat.name}`} on:click={() => toggleChat(chat)}><span></span></button>
              </article>
            {:else}
              <div class="empty">Nenhum chat encontrado. Envie uma mensagem ao bot para cadastrá-lo como bloqueado.</div>
            {/each}
          </div>
        </section>
      {:else}
        <section class="card" aria-labelledby="automation-title">
          <h2 id="automation-title">Atendimento automático</h2>
          <label for="start-message">Mensagem de /start para todos</label>
          <textarea id="start-message" rows="5" maxlength="4096" bind:value={settings.startMessage}></textarea>
          <p class="hint">Essa mensagem é enviada mesmo para chats não ativados.</p>

          <div class="model-grid" aria-label="Modelos do Telegram">
            <label for="admin-model">Modelo para admin e chats autorizados
              <select id="admin-model" bind:value={settings.adminModel}>
                <option value="">Automático</option>
                {#each models as model}
                  <option value={model.id}>{model.name} · {model.providerLabel}</option>
                {/each}
              </select>
            </label>
            <label for="public-model">Modelo para atendimento público
              <select id="public-model" bind:value={settings.publicModel} disabled={!settings.publicEnabled}>
                <option value="">Do especialista / automático</option>
                {#each models as model}
                  <option value={model.id}>{model.name} · {model.providerLabel}</option>
                {/each}
              </select>
            </label>
          </div>
          {#if modelsError}<p class="warning" role="status">{modelsError}</p>{/if}
          <p class="hint">“Automático” mantém o roteamento normal. No atendimento público, o modelo definido aqui prevalece sobre o modelo do especialista.</p>

          <label class="check-row">
            <input type="checkbox" bind:checked={settings.publicEnabled} disabled={!specialistsAvailable} />
            Permitir atendimento público por especialista
          </label>
          {#if !specialistsAvailable}
            <p class="warning" role="status">O pacote Specialists não está disponível. O atendimento público permanece desligado.</p>
          {/if}

          <label for="public-specialist">Especialista público</label>
          <select id="public-specialist" bind:value={settings.specialistId} disabled={!settings.publicEnabled || !specialistsAvailable}>
            <option value="">Selecione um especialista</option>
            {#each specialists as specialist}
              <option value={specialist.id} disabled={!specialist.eligible}>{specialist.name}{specialist.eligible ? '' : ' (não permitido)'}</option>
            {/each}
          </select>
          {#if settings.specialistId && specialists.find(item => item.id === settings.specialistId)?.warning}
            <p class="warning" role="alert">{specialists.find(item => item.id === settings.specialistId).warning}</p>
          {/if}
          <p class="hint">Especialistas com tools unrestricted são bloqueados porque dariam poder excessivo a qualquer usuário público.</p>

          <label for="default-chat">Destinatário padrão das tools</label>
          <select id="default-chat" bind:value={settings.defaultChatId}>
            <option value="">Automático quando houver um único chat</option>
            {#each chats as chat}
              <option value={chat.chatId}>{chat.name} ({chat.chatId})</option>
            {/each}
          </select>
          <button class="primary" disabled={busy || !settings.startMessage.trim() || (settings.publicEnabled && !settings.specialistId)} on:click={saveSettings}>{busy ? 'Salvando...' : 'Salvar atendimento'}</button>
        </section>
      {/if}
    </div>
  </section>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; }
  [data-theme='dark'] { --tk-bg:#111111;--tk-surface:#181818;--tk-surface-2:#1f1f1f;--tk-border:rgba(255,255,255,.09);--tk-border-hi:rgba(255,255,255,.16);--tk-text:#f5f5f5;--tk-muted:#888888;--tk-muted-2:rgba(136,136,136,.5);--tk-accent:#f5f5f5;--tk-on-accent:#111111;--tk-radius-md:8px;--tk-radius-lg:14px;--tk-font:'Ubuntu',system-ui,sans-serif;--tk-mono:'Ubuntu Mono',monospace; }
  [data-theme='light'] { --tk-bg:#ffffff;--tk-surface:#f5f5f5;--tk-surface-2:#ececec;--tk-border:rgba(0,0,0,.10);--tk-border-hi:rgba(0,0,0,.18);--tk-text:#1a1a1a;--tk-muted:#666666;--tk-muted-2:rgba(0,0,0,.4);--tk-accent:#111111;--tk-on-accent:#ffffff;--tk-radius-md:8px;--tk-radius-lg:14px;--tk-font:'Ubuntu',system-ui,sans-serif;--tk-mono:'Ubuntu Mono',monospace; }
  .page { min-height:100dvh;background:var(--tk-bg);color:var(--tk-text);font-family:var(--tk-font);padding:24px; }
  .shell { width:min(680px,100%);margin:0 auto;border:1px solid var(--tk-border);border-radius:var(--tk-radius-lg);overflow:hidden;background:var(--tk-surface); }
  .topbar { display:flex;align-items:center;gap:10px;min-height:52px;padding:0 16px;border-bottom:1px solid var(--tk-border); }
  svg { width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round; }
  h1,h2,p { margin:0; } h1 { font-size:15px;font-weight:600; } h2 { font-size:15px;margin-bottom:18px; } .bot-name,.hint,.lead,small { color:var(--tk-muted);font-size:13px; }.bot-name { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
  .status { margin-left:auto;border:1px solid var(--tk-border-hi);border-radius:999px;padding:5px 9px;color:var(--tk-muted);font-size:12px; }
  .status.online { color:var(--tk-text);background:var(--tk-surface-2); }
  nav { display:flex;border-bottom:1px solid var(--tk-border);padding:0 12px; }
  nav button { flex:1;padding:13px 8px;background:transparent;color:var(--tk-muted);border:0;border-bottom:2px solid transparent;font:500 13px var(--tk-font);cursor:pointer; }
  nav button.active { color:var(--tk-text);border-bottom-color:var(--tk-accent); } button:disabled { opacity:.4;cursor:not-allowed; }
  .content { padding:18px; } .card { display:flex;flex-direction:column;gap:10px; }
  label { font-size:12px;color:var(--tk-muted);margin-top:6px; }
  input,textarea,select,code { width:100%;border:1px solid var(--tk-border-hi);border-radius:var(--tk-radius-md);background:var(--tk-bg);color:var(--tk-text);padding:11px 12px;font:14px var(--tk-font);outline:none; }
  code { font-family:var(--tk-mono);word-break:break-all; } input:focus,textarea:focus { border-color:var(--tk-accent); }
  button { font-family:var(--tk-font); } .primary,.danger { border:1px solid var(--tk-border-hi);border-radius:var(--tk-radius-md);padding:11px 14px;margin-top:8px;cursor:pointer; }
  .primary { background:var(--tk-accent);color:var(--tk-on-accent); } .danger { background:transparent;color:var(--tk-text); }
  .notice { margin:14px 18px 0;padding:10px 12px;border:1px solid var(--tk-border-hi);border-radius:var(--tk-radius-md);font-size:13px;background:var(--tk-surface-2); }
  .title-row,.chat-row { display:flex;align-items:center;justify-content:space-between;gap:12px; }
  .icon-button { border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);background:transparent;color:var(--tk-text);padding:8px;cursor:pointer; }
  .chat-list { margin-top:6px;border-top:1px solid var(--tk-border); }
  .chat-row { padding:13px 0;border-bottom:1px solid var(--tk-border); } .chat-row div { min-width:0; } strong,small { display:block;overflow:hidden;text-overflow:ellipsis; }
  .toggle { width:42px;height:24px;border:0;border-radius:999px;background:var(--tk-surface-2);padding:3px;cursor:pointer;flex:0 0 auto; }
  .toggle span { display:block;width:18px;height:18px;border-radius:50%;background:var(--tk-muted);transition:transform 220ms ease-out,opacity 220ms ease-out; }
  .toggle.enabled { background:var(--tk-accent); } .toggle.enabled span { transform:translateX(18px);background:var(--tk-on-accent); }
  .empty { color:var(--tk-muted);font-size:13px;text-align:center;padding:28px 10px;line-height:1.5; }
  .check-row { display:flex;align-items:center;gap:9px;color:var(--tk-text);margin-top:12px; }
  .check-row input { width:auto; }
  .warning { color:var(--tk-text);border-left:2px solid var(--tk-border-hi);padding:8px 10px;background:var(--tk-surface-2);font-size:13px;line-height:1.45; }
  .model-grid { display:grid;grid-template-columns:1fr 1fr;gap:12px; }.model-grid label { display:grid;gap:6px; }
  @media (max-width:560px) { .model-grid { grid-template-columns:1fr; } }
  @media (max-width:560px) { .page { padding:0; } .shell { min-height:100dvh;border:0;border-radius:0; } .content { padding:16px; } }
</style>
