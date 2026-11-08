import { describe, expect, it } from 'vitest'
import { formatBytes, managuaDate, parseContentDisposition, presetRange, rangeDays, reportPath, validateRange } from './reportsApi'

describe('managuaDate', () => {
  it('usa UTC−6 fijo y no la zona del navegador', () => {
    // 05:59 UTC todavía es el día anterior en Managua; 06:00 UTC ya es el nuevo.
    expect(managuaDate(new Date('2026-11-08T05:59:59Z'))).toBe('2026-11-07')
    expect(managuaDate(new Date('2026-11-08T06:00:00Z'))).toBe('2026-11-08')
    expect(managuaDate(new Date('2026-01-01T03:00:00Z'))).toBe('2025-12-31')
  })
})

describe('presetRange', () => {
  const today = '2026-11-08'
  it('calcula los atajos', () => {
    expect(presetRange('today', today)).toEqual({ from: '2026-11-08', to: '2026-11-08' })
    expect(presetRange('yesterday', today)).toEqual({ from: '2026-11-07', to: '2026-11-07' })
    expect(presetRange('last7', today)).toEqual({ from: '2026-11-02', to: '2026-11-08' })
    expect(presetRange('thisMonth', today)).toEqual({ from: '2026-11-01', to: '2026-11-08' })
    expect(presetRange('lastMonth', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })
  it('cruza límites de mes y de año', () => {
    expect(presetRange('yesterday', '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-02-28' })
    expect(presetRange('yesterday', '2024-03-01')).toEqual({ from: '2024-02-29', to: '2024-02-29' })
    expect(presetRange('last7', '2026-01-03')).toEqual({ from: '2025-12-28', to: '2026-01-03' })
    expect(presetRange('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(presetRange('lastMonth', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
})

describe('validateRange', () => {
  const today = '2026-11-08'
  const strict = { allowFuture: false }
  it('acepta rangos válidos', () => {
    expect(validateRange({ from: '2026-11-01', to: '2026-11-08' }, today, strict)).toBeNull()
    expect(validateRange({ from: '2026-11-08', to: '2026-11-08' }, today, strict)).toBeNull()
  })
  it('exige ambas fechas', () => {
    expect(validateRange({ from: '', to: '2026-11-08' }, today, strict)).toMatch(/Elegí/)
    expect(validateRange({ from: '2026-11-01', to: '' }, today, strict)).toMatch(/Elegí/)
  })
  it('rechaza fechas con formato imposible', () => {
    expect(validateRange({ from: '2026-02-30', to: '2026-03-01' }, today, strict)).toMatch(/no es válida/)
    expect(validateRange({ from: '08/11/2026', to: '2026-11-08' }, today, strict)).toMatch(/no es válida/)
  })
  it('exige desde ≤ hasta', () => {
    expect(validateRange({ from: '2026-11-08', to: '2026-11-07' }, today, strict)).toMatch(/posterior/)
  })
  it('no admite fechas futuras cuando se indica', () => {
    expect(validateRange({ from: '2026-11-08', to: '2026-11-09' }, today, strict)).toMatch(/futuras/)
    expect(validateRange({ from: '2026-11-08', to: '2026-11-09' }, today, { allowFuture: true })).toBeNull()
  })
  it('limita el rango a 366 días contando ambos extremos', () => {
    expect(rangeDays({ from: '2025-11-08', to: '2026-11-08' })).toBe(366)
    expect(validateRange({ from: '2025-11-08', to: '2026-11-08' }, today, strict)).toBeNull()
    expect(validateRange({ from: '2025-11-07', to: '2026-11-08' }, today, strict)).toMatch(/366 días y elegiste 367/)
  })
})

describe('parseContentDisposition', () => {
  it('lee filename entre comillas', () => {
    expect(parseContentDisposition('attachment; filename="ventas_2026-11-01_2026-11-08.xlsx"')).toBe('ventas_2026-11-01_2026-11-08.xlsx')
  })
  it('lee filename sin comillas', () => {
    expect(parseContentDisposition('attachment; filename=inventario.xlsx')).toBe('inventario.xlsx')
  })
  it('prefiere filename* en UTF-8', () => {
    expect(parseContentDisposition(`attachment; filename="existencias.xlsx"; filename*=UTF-8''Existencias%20Camis%C3%B3n.xlsx`)).toBe('Existencias Camisón.xlsx')
    expect(parseContentDisposition(`attachment; filename*=UTF-8''cajas%20y%20cierres.xlsx`)).toBe('cajas y cierres.xlsx')
  })
  it('acepta latin1 y comillas escapadas', () => {
    expect(parseContentDisposition(`attachment; filename*=iso-8859-1''Camis%F3n.xlsx`)).toBe('Camisón.xlsx')
    expect(parseContentDisposition('attachment; filename="a\\"b.xlsx"')).toBe('a"b.xlsx')
  })
  it('cae en filename si filename* está mal codificado', () => {
    expect(parseContentDisposition(`attachment; filename="ok.xlsx"; filename*=UTF-8''%E0%A4%A.xlsx`)).toBe('ok.xlsx')
  })
  it('descarta rutas y devuelve null si no hay nombre', () => {
    expect(parseContentDisposition('attachment; filename="../../etc/pasa.xlsx"')).toBe('pasa.xlsx')
    expect(parseContentDisposition('attachment')).toBeNull()
    expect(parseContentDisposition(null)).toBeNull()
    expect(parseContentDisposition('attachment; filename=""')).toBeNull()
  })
})

describe('formatBytes y reportPath', () => {
  it('formatea tamaños', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(23 * 1024)).toBe('23 KB')
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB')
  })
  it('arma las rutas del contrato', () => {
    expect(reportPath('sales', { from: '2026-11-01', to: '2026-11-08' })).toBe('/api/v1/reports/sales?from=2026-11-01&to=2026-11-08')
    expect(reportPath('inventory')).toBe('/api/v1/reports/inventory')
    expect(reportPath('inventory', { from: '2026-11-01', to: '2026-11-08' })).toBe('/api/v1/reports/inventory')
    expect(reportPath('movements', { from: '2026-11-01', to: '2026-11-08' })).toBe('/api/v1/reports/movements?from=2026-11-01&to=2026-11-08')
    expect(reportPath('cash', { from: '2026-11-08', to: '2026-11-08' })).toBe('/api/v1/reports/cash?from=2026-11-08&to=2026-11-08')
  })
})
