import { useId, useState } from 'react'
import { hasPermission } from '../lib/access'
import type { CurrentUser } from '../types'
import { managuaDate, useReportDownload, validateRange, type DateRange, type ReportKind } from '../admin/reportsApi'
import { DateRangePicker, DownloadButton, DownloadResult } from '../admin/reportsUi'

type ReportDefinition = {
  kind: ReportKind
  permission: string
  title: string
  description: string
  sheets: string
  usesRange: boolean
  allowFuture: boolean
  extra?: (user: CurrentUser) => string | null
}

const reports: ReportDefinition[] = [
  {
    kind: 'sales', permission: 'sale.read', title: 'Ventas',
    description: 'Resumen del período, todas las ventas, detalle por producto y pagos por método.',
    sheets: 'Hojas: Resumen, Ventas, Detalle y Pagos.', usesRange: true, allowFuture: false,
  },
  {
    kind: 'inventory', permission: 'inventory.read', title: 'Existencias actuales',
    description: 'Cuántas unidades hay de cada variante hoy, con su resumen de stock.',
    sheets: 'Hojas: Existencias y Resumen.', usesRange: false, allowFuture: false,
    extra: (user) => (hasPermission(user, 'inventory.cost.read')
      ? 'Incluye costo y valor del inventario porque tu cuenta tiene permiso de costos.'
      : 'Los costos y el valor del inventario solo se incluyen si tu cuenta tiene permiso de costos; la tuya no lo tiene, así que no vendrán en el archivo.'),
  },
  {
    kind: 'movements', permission: 'inventory.kardex.read', title: 'Movimientos de inventario',
    description: 'Kardex general: entradas, ajustes, pérdidas, ventas y anulaciones del período.',
    sheets: 'Hoja: Movimientos.', usesRange: true, allowFuture: true,
  },
  {
    kind: 'cash', permission: 'cash.report.read', title: 'Cierres de caja',
    description: 'Cierres por caja, consolidado por día y transferencias por banco.',
    sheets: 'Hojas: Cierres por caja, Consolidado por día y Transferencias por banco.', usesRange: true, allowFuture: false,
  },
]

function ReportCard({ report, user, today }: { report: ReportDefinition; user: CurrentUser; today: string }) {
  const [range, setRange] = useState<DateRange>({ from: today, to: today })
  const [touched, setTouched] = useState(false)
  const { state, start, reset } = useReportDownload()
  const id = useId()
  const errorId = `${id}-error`

  // La validación se muestra en vivo una vez que la persona tocó las fechas o intentó descargar.
  const liveError = report.usesRange ? validateRange(range, today, { allowFuture: report.allowFuture }) : null
  const shownError = touched ? liveError : null
  const busy = state.status === 'busy'
  const note = report.extra?.(user) ?? null

  function changeRange(next: DateRange) {
    setRange(next)
    setTouched(true)
    reset()
  }

  function handleDownload() {
    if (liveError) { setTouched(true); return }
    void start(report.kind, report.usesRange ? range : undefined)
  }

  return (
    <section className="panel-card adm-card rep-card" aria-labelledby={`${id}-title`} aria-busy={busy}>
      <header>
        <h2 id={`${id}-title`}>{report.title}</h2>
        <p className="rep-desc">{report.description}</p>
        <p className="rep-sheets">{report.sheets}</p>
      </header>

      {report.usesRange
        ? <DateRangePicker value={range} onChange={changeRange} today={today} allowFuture={report.allowFuture} error={shownError} errorId={errorId} />
        : <p className="rep-nodate">Este reporte no necesita fechas: refleja las existencias al momento de descargarlo.</p>}
      {shownError && <p className="rep-error" id={errorId}>{shownError}</p>}
      {note && <p className="adm-help rep-note">{note}</p>}

      <div className="rep-actions">
        <DownloadButton busy={busy} disabled={Boolean(shownError)} onClick={handleDownload} />
      </div>
      <div aria-live="polite" className="rep-result"><DownloadResult state={state} /></div>
    </section>
  )
}

export function ReportsView({ user }: { user: CurrentUser }) {
  const today = managuaDate()
  const available = reports.filter((report) => hasPermission(user, report.permission))

  return (
    <main className="admin-page adm-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Análisis · <b className="live-data">Datos reales</b></p>
          <h1>Reportes</h1>
          <p className="page-summary">Descargá la información de la tienda en archivos de Excel (.xlsx). Las fechas son de Managua y los reportes se generan en el servidor.</p>
        </div>
      </header>

      {available.length === 0 ? (
        <section className="panel-card adm-card"><p className="adm-empty-cell">Tu cuenta no tiene reportes disponibles.</p></section>
      ) : (
        <div className="rep-grid">
          {available.map((report) => <ReportCard key={report.kind} report={report} user={user} today={today} />)}
        </div>
      )}

      <p className="adm-help rep-footnote">
        Todavía no hay reporte de compras: el módulo de compras aún no existe. Los reportes necesitan conexión con el servidor.
      </p>
    </main>
  )
}
