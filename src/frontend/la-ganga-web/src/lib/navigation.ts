import {
  Boxes,
  ChartColumn,
  Handshake,
  Landmark,
  LayoutDashboard,
  Package,
  ReceiptText,
  ScanBarcode,
  ScrollText,
  Settings,
  Shirt,
  ShoppingBag,
  Tags,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { AppView } from '../types'

export type NavItem = { view: AppView; label: string; icon: LucideIcon }

/** Una categoría desplegable del menú. `group: null` = elemento suelto (sin categoría). */
export type NavGroup = { id: string; label: string; icon: LucideIcon; items: NavItem[] }

/**
 * Mapa de navegación del panel, por categoría de trabajo (no por pantalla técnica):
 * - Ventas: lo que se hace cada día en la tienda.
 * - Inventario: qué hay y cómo se llama.
 * - Finanzas: cuánto se invirtió, cuánto se ganó y reportes.
 * - Administración: personas, ajustes y auditoría.
 * Cada persona solo ve lo que sus permisos habilitan; una categoría sin pantallas permitidas no aparece.
 */
export const navHome: NavItem = { view: 'panel', label: 'Panel', icon: LayoutDashboard }

export const navGroups: NavGroup[] = [
  {
    id: 'ventas',
    label: 'Ventas',
    icon: ShoppingBag,
    items: [
      { view: 'pos', label: 'Punto de venta', icon: ScanBarcode },
      { view: 'ventas', label: 'Historial de ventas', icon: ReceiptText },
      { view: 'caja', label: 'Caja y cierres', icon: Wallet },
    ],
  },
  {
    id: 'inventario',
    label: 'Inventario',
    icon: Package,
    items: [
      { view: 'productos', label: 'Productos', icon: Shirt },
      { view: 'inventario', label: 'Existencias', icon: Boxes },
      { view: 'catalogos', label: 'Catálogos', icon: Tags },
    ],
  },
  {
    id: 'finanzas',
    label: 'Finanzas',
    icon: Landmark,
    items: [
      { view: 'socios', label: 'Socios e inversión', icon: Handshake },
      { view: 'reportes', label: 'Reportes', icon: ChartColumn },
    ],
  },
  {
    id: 'administracion',
    label: 'Administración',
    icon: Settings,
    items: [
      { view: 'equipo', label: 'Equipo', icon: Users },
      { view: 'configuracion', label: 'Configuración', icon: Settings },
      { view: 'auditoria', label: 'Auditoría', icon: ScrollText },
    ],
  },
]

/** Categorías con solo las pantallas permitidas; las vacías se omiten. */
export function visibleGroups(allowed: AppView[]): NavGroup[] {
  return navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => allowed.includes(item.view)) }))
    .filter((group) => group.items.length > 0)
}

/** Dónde está una pantalla (para el «migas de pan» y para abrir su categoría). */
export function locate(view: AppView): { group: NavGroup | null; item: NavItem } | null {
  if (view === navHome.view) return { group: null, item: navHome }
  for (const group of navGroups) {
    const item = group.items.find((candidate) => candidate.view === view)
    if (item) return { group, item }
  }
  return null
}
