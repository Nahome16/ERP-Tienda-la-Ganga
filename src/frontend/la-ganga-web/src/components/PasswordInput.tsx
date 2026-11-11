import { useState, type InputHTMLAttributes } from 'react'
import { Check, Eye, EyeOff, X } from 'lucide-react'
import { passwordRules } from '../lib/passwordRules'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

/** Campo de contraseña con botón para verla y comprobar si se escribió bien. */
export function PasswordInput({ className, ...props }: Props) {
  const [visible, setVisible] = useState(false)
  return (
    <span className={`password-input${className ? ` ${className}` : ''}`}>
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button" className="password-toggle" onClick={() => setVisible((value) => !value)}
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible}
        title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        {visible ? <EyeOff size={18} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={18} strokeWidth={1.75} aria-hidden="true" />}
      </button>
    </span>
  )
}

/** Requisitos de la contraseña con su check, que se marcan a medida que se cumplen. */
export function PasswordChecklist({ password, confirmation }: { password: string; confirmation?: string }) {
  const rules = passwordRules(password)
  const items = confirmation === undefined
    ? rules
    : [...rules, { id: 'match', label: 'Las dos contraseñas coinciden', ok: password.length > 0 && password === confirmation }]
  return (
    <ul className="password-checklist" aria-label="Requisitos de la contraseña">
      {items.map((rule) => (
        <li key={rule.id} className={rule.ok ? 'is-ok' : undefined}>
          {rule.ok ? <Check size={15} strokeWidth={2.5} aria-hidden="true" /> : <X size={15} strokeWidth={2.5} aria-hidden="true" />}
          <span>{rule.label}</span>
          <span className="sr-only">{rule.ok ? ' (cumple)' : ' (falta)'}</span>
        </li>
      ))}
    </ul>
  )
}
