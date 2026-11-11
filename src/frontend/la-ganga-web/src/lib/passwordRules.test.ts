import { describe, expect, it } from 'vitest'
import { isPasswordStrong, passwordRules } from './passwordRules'

describe('passwordRules', () => {
  it('marca lo que falta', () => {
    const missing = passwordRules('solominusculas123456').filter((rule) => !rule.ok).map((rule) => rule.id)
    expect(missing).toEqual(['upper', 'symbol'])
  })

  it('acepta solo contraseñas que cumplen todo', () => {
    expect(isPasswordStrong('Ejemplo-de-prueba-99')).toBe(true)
    expect(isPasswordStrong('Corta-1')).toBe(false)
    expect(isPasswordStrong('Ñandú-de-campo-2026')).toBe(true)
  })
})
