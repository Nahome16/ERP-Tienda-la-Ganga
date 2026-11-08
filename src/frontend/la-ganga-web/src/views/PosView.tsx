import { PosApp, type PosAppProps } from '../pos/PosApp'

export type PosViewProps = PosAppProps

/**
 * Punto de venta con modo sin conexión. Toda la lógica vive en src/pos:
 * caja, escáner, carrito, cobro mixto, cola local (IndexedDB) y sincronización.
 */
export function PosView(props: PosViewProps) {
  return <PosApp {...props} />
}
