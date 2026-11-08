import { apiRequest } from '../lib/api'
import type { InvestmentSummary, Lot, LotSource, Partner, PartnerSummary, ProductBreakdown } from '../lib/apiTypes'
import { addDays } from './format'
import { maxRangeDays, rangeDays, type DateRange } from './reportsApi'

const v1 = '/api/v1'

/** Fechas YYYY-MM-DD en hora de Managua; una cadena vacía significa «sin límite». */
export type InvRange = { from: string; to: string }

/** Filtro de socio: '' = todos, 'none' = «Sin socio», o el id del socio. */
export type PartnerFilter = string

export const noPartner = 'none'

export type InvPresetId = 'today' | 'thisMonth' | 'lastMonth' | 'all'

export const invPresets: { id: InvPresetId; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'thisMonth', label: 'Este mes' },
  { id: 'lastMonth', label: 'Mes pasado' },
  { id: 'all', label: 'Todo' },
]

/** Rango de un atajo a partir de «hoy» en Managua. «Todo» no pone límites. */
export function invPresetRange(id: InvPresetId, today: string): InvRange {
  const monthStart = `${today.slice(0, 7)}-01`
  switch (id) {
    case 'today': return { from: today, to: today }
    case 'thisMonth': return { from: monthStart, to: today }
    case 'lastMonth': {
      const lastDay = addDays(monthStart, -1)
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay }
    }
    case 'all': return { from: '', to: '' }
  }
}

export function isAllRange(range: InvRange): boolean {
  return range.from === '' && range.to === ''
}

/** Mensaje para la persona si el rango no sirve, o null si es válido. Cualquiera de los extremos puede faltar. */
export function validateInvRange(range: InvRange, today: string): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if ((range.from && !iso.test(range.from)) || (range.to && !iso.test(range.to))) return 'Alguna de las fechas no es válida. Usá el formato día/mes/año.'
  if (range.from && range.to && range.from > range.to) return 'La fecha «Desde» no puede ser posterior a «Hasta».'
  if ((range.from && range.from > today) || (range.to && range.to > today)) return 'Las fechas no pueden ser futuras: usá hoy o antes.'
  return null
}

/** Texto que describe el rango («Todo el historial», «Desde 1 nov 2026»…). */
export function describeRange(range: InvRange, format: (isoDate: string) => string): string {
  if (isAllRange(range)) return 'Todo el historial'
  if (range.from && range.to) return range.from === range.to ? format(range.from) : `${format(range.from)} al ${format(range.to)}`
  if (range.from) return `Desde ${format(range.from)}`
  return `Hasta ${format(range.to)}`
}

export type ExcelRange =
  | { ok: true; range: DateRange; clamped: boolean }
  | { ok: false; message: string }

/**
 * El Excel exige las dos fechas y admite como máximo 366 días. Con «Todo» (o con un solo
 * extremo) completa lo que falta y recorta al último año; `clamped` avisa que se recortó.
 */
export function excelRange(range: InvRange, today: string): ExcelRange {
  const problem = validateInvRange(range, today)
  if (problem) return { ok: false, message: problem }
  let from = range.from
  const to = range.to || today
  let clamped = false
  if (!from) {
    from = addDays(to, -(maxRangeDays - 1))
    clamped = true
  }
  if (rangeDays({ from, to }) > maxRangeDays) {
    if (range.from && range.to) {
      return { ok: false, message: `El Excel admite hasta ${maxRangeDays} días y elegiste ${rangeDays({ from, to })}. Acortá el rango e intentá de nuevo.` }
    }
    from = addDays(to, -(maxRangeDays - 1))
    clamped = true
  }
  return { ok: true, range: { from, to }, clamped }
}

const sourceLabels: Record<LotSource, string> = {
  InitialStock: 'Existencia inicial',
  Entry: 'Entrada',
  Adjustment: 'Ajuste',
  Import: 'Importación',
  Opening: 'Saldo inicial',
  Restock: 'Sin entrada registrada',
}

export function sourceLabel(source: LotSource | string): string {
  return (sourceLabels as Record<string, string>)[source] ?? source
}

/** Valor de `partnerId` para la API: el id, `none` para «Sin socio» o nada. */
export function partnerParam(filter: PartnerFilter): string | null {
  return filter === '' ? null : filter
}

/** Filtro de socio de una fila de resumen o de entrada. */
export function filterOf(partnerId: string | null): PartnerFilter {
  return partnerId ?? noPartner
}

function queryString(values: Record<string, string | number | boolean | null | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '' || value === false) continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

export type LotFilter = {
  partner: PartnerFilter
  search: string
  onlyWithStock: boolean
  range: InvRange
  page: number
  pageSize: number
}

export type LotPage = { items: Lot[]; page: number; pageSize: number; totalCount: number; totalPages: number }

export const listPartners = (status: 'active' | 'all', signal?: AbortSignal) =>
  apiRequest<Partner[]>(`${v1}/investment/partners${queryString({ status })}`, { signal })

export type PartnerInput = { name: string; phone: string | null; notes: string | null }

export const createPartner = (input: PartnerInput) =>
  apiRequest<Partner>(`${v1}/investment/partners`, { method: 'POST', body: input })

export const updatePartner = (partner: Pick<Partner, 'id' | 'version'>, input: PartnerInput & { isActive: boolean }) =>
  apiRequest<Partner>(`${v1}/investment/partners/${partner.id}`, { method: 'PUT', body: input, ifMatch: partner.version })

export const getSummary = (range: InvRange, signal?: AbortSignal) =>
  apiRequest<InvestmentSummary>(`${v1}/investment/summary${queryString({ from: range.from, to: range.to })}`, { signal })

export const getBreakdown = (partner: PartnerFilter, range: InvRange, signal?: AbortSignal) =>
  apiRequest<ProductBreakdown[]>(`${v1}/investment/breakdown${queryString({ partnerId: partnerParam(partner), from: range.from, to: range.to })}`, { signal })

export const listLots = (filter: LotFilter, signal?: AbortSignal) =>
  apiRequest<LotPage>(`${v1}/investment/lots${queryString({
    partnerId: partnerParam(filter.partner),
    search: filter.search.trim(),
    onlyWithStock: filter.onlyWithStock,
    from: filter.range.from,
    to: filter.range.to,
    page: filter.page,
    pageSize: filter.pageSize,
  })}`, { signal })

export type LotUpdate = { partnerId: string | null; unitCost: number | null; unitPrice: number | null; note: string | null }

export const updateLot = (id: string, body: LotUpdate) =>
  apiRequest<Lot>(`${v1}/investment/lots/${id}`, { method: 'PUT', body })

/** Cuerpo que conserva todo lo de la entrada y solo cambia el socio. */
export function lotWithPartner(lot: Pick<Lot, 'unitCost' | 'unitPrice' | 'note'>, partnerId: string | null): LotUpdate {
  return { partnerId, unitCost: lot.unitCost, unitPrice: lot.unitPrice, note: lot.note }
}

/** Texto de un número entero de dinero nulo como «—». */
export function moneyOrDash(value: number | null, format: (n: number) => string): string {
  return value === null ? '—' : format(value)
}

export type ProfitInfo = { negative: boolean; partial: boolean; incompleteInvestment: boolean }

/** Cómo mostrar la ganancia y la inversión de una fila de resumen. */
export function profitInfo(row: Pick<PartnerSummary, 'profitNio' | 'soldUnitsWithoutCost' | 'unitsWithoutCost'>): ProfitInfo {
  return { negative: row.profitNio < 0, partial: row.soldUnitsWithoutCost > 0, incompleteInvestment: row.unitsWithoutCost > 0 }
}

/**
 * Convierte el texto de un campo de dinero: vacío = null (sin dato); inválido o negativo = 'invalid'.
 * Acepta coma o punto como separador decimal.
 */
export function parseMoneyField(raw: string): number | null | 'invalid' {
  const text = raw.trim().replace(/^(C\$)/i, '').trim()
  if (text === '') return null
  if (!/^\d+([.,]\d{1,4})?$/.test(text)) return 'invalid'
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) ? value : 'invalid'
}

/** Número como texto editable (sin separadores de miles). */
export function moneyToField(value: number | null): string {
  return value === null ? '' : String(value)
}
