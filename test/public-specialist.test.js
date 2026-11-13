import test from 'node:test'
import assert from 'node:assert/strict'

import { assessPublicSpecialist } from '../lib/public-specialist.js'

test('especialista inexistente ou irrestrito e recusado para publico com motivo explicito', () => {
  assert.deepEqual(assessPublicSpecialist(null), { allowed: false, reason: 'Especialista não encontrado.' })
  assert.deepEqual(assessPublicSpecialist({ toolsAllowlist: null }), {
    allowed: false,
    reason: 'Este especialista usa tools unrestricted e não pode atender usuários públicos.',
  })
})

test('especialista sem tools ou com allowlist explicita pode atender publico', () => {
  assert.equal(assessPublicSpecialist({ toolsAllowlist: [] }).allowed, true)
  assert.equal(assessPublicSpecialist({ toolsAllowlist: ['buscar'] }).allowed, true)
})
