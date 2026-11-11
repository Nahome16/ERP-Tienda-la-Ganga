/** Usuario y contraseña de quien autoriza en la caja. */
export type Approver = { username: string; password: string }

export const emptyApprover: Approver = { username: '', password: '' }

export function approverReady(value: Approver): boolean {
  return value.username.trim().length > 0 && value.password.length > 0
}
