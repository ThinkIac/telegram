export function assessPublicSpecialist(specialist) {
  if (!specialist) return { allowed: false, reason: 'Especialista não encontrado.' }
  if (specialist.toolsAllowlist === null) {
    return { allowed: false, reason: 'Este especialista usa tools unrestricted e não pode atender usuários públicos.' }
  }
  return { allowed: true, reason: null }
}

export async function createSpecialistAdapter() {
  try {
    const [{ getSpecialistById }, { executeSpecialist }] = await Promise.all([
      import('../../specialists/lib/catalog.js'),
      import('../../specialists/lib/executor.js'),
    ])
    return {
      inspect: async id => getSpecialistById(id),
      execute: async ({ specialist, message, chatId, sender, model = null }) => executeSpecialist({
        specialistId: specialist.id,
        message,
        context: { channel: 'telegram', chatId, sender },
        toolNames: specialist.toolsAllowlist,
        model,
        sessionId: `telegram-public-${chatId}`,
      }),
    }
  } catch {
    return null
  }
}

export async function inspectPublicSpecialist(id) {
  const adapter = await createSpecialistAdapter()
  if (!adapter) return { specialist: null, assessment: { allowed: false, reason: 'O pacote Specialists não está disponível.' } }
  const specialist = await adapter.inspect(id)
  return { specialist, assessment: assessPublicSpecialist(specialist) }
}
