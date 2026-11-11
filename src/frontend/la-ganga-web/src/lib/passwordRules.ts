import { passwordMinLength } from './usersApi'

/** Requisitos de una contraseña nueva. Son los mismos que valida el servidor (UserRules.PasswordProblems). */
export type PasswordRule = { id: string; label: string; ok: boolean }

export function passwordRules(password: string): PasswordRule[] {
  return [
    { id: 'length', label: `Al menos ${passwordMinLength} caracteres`, ok: password.length >= passwordMinLength },
    { id: 'upper', label: 'Una mayúscula (A-Z)', ok: /\p{Lu}/u.test(password) },
    { id: 'lower', label: 'Una minúscula (a-z)', ok: /\p{Ll}/u.test(password) },
    { id: 'digit', label: 'Un número (0-9)', ok: /\p{Nd}/u.test(password) },
    { id: 'symbol', label: 'Un símbolo (- . @ ! # …)', ok: /[^\p{L}\p{Nd}\s]/u.test(password) },
  ]
}

export function isPasswordStrong(password: string): boolean {
  return passwordRules(password).every((rule) => rule.ok)
}
