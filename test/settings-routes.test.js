import test from 'node:test'
import assert from 'node:assert/strict'

import { validateSettingsChange } from '../routes.js'

test('backend impede ativar especialista irrestrito mesmo com bypass da interface', async () => {
  await assert.rejects(
    validateSettingsChange({ publicEnabled: true, specialistId: 'unsafe' }, {
      current: { publicEnabled: false, specialistId: null },
      inspect: async () => ({ specialist: { toolsAllowlist: null }, assessment: { allowed: false, reason: 'Este especialista usa tools unrestricted e não pode atender usuários públicos.' } }),
    }),
    /unrestricted/,
  )
})

test('backend aceita atendimento publico com allowlist explicita', async () => {
  const result = await validateSettingsChange({ publicEnabled: true, specialistId: 'safe' }, {
    current: { publicEnabled: false, specialistId: null },
    inspect: async () => ({ specialist: { toolsAllowlist: ['buscar'] }, assessment: { allowed: true, reason: null } }),
  })
  assert.equal(result.publicEnabled, true)
})
