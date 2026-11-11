import { CircleAlert, CircleCheck, TriangleAlert, X } from 'lucide-react'

type Message = { tone: 'ok' | 'warn' | 'error'; text: string; code?: string }

const titles = { ok: 'Código agregado', warn: 'Revisá este código', error: 'No se pudo leer el código' } as const
const icons = { ok: CircleCheck, warn: TriangleAlert, error: CircleAlert } as const

/**
 * Resultado del último escaneo en el alta del producto: grande y fácil de leer de un vistazo
 * (verde si quedó asignado, ámbar si ya existe o está repetido, rojo si falló).
 */
export function ScanResult({ message, onOpenExisting, onDismiss }: {
  message: Message
  onOpenExisting?: () => void
  onDismiss: () => void
}) {
  const Icon = icons[message.tone]
  const title = message.tone === 'warn' && onOpenExisting ? 'Este código ya existe' : titles[message.tone]
  return (
    <div className={`adm-scanresult ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
      <span className="adm-scanresult-icon" aria-hidden="true"><Icon size={26} strokeWidth={2} /></span>
      <div className="adm-scanresult-body">
        <strong>{title}</strong>
        {message.code && <code className="adm-scanresult-code">{message.code}</code>}
        <p>{message.text}</p>
        {onOpenExisting && (
          <button type="button" className="secondary-button" onClick={onOpenExisting}>Abrir ese producto</button>
        )}
      </div>
      <button type="button" className="adm-scanresult-close" aria-label="Cerrar aviso" onClick={onDismiss}><X size={20} /></button>
    </div>
  )
}
