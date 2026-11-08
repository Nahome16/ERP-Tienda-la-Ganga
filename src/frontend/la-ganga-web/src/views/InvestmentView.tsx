import { useId, useState } from 'react'
import { hasPermission } from '../lib/access'
import type { InvestmentSummary, Partner } from '../lib/apiTypes'
import type { CurrentUser } from '../types'
import { formatIsoDate, managuaToday } from '../admin/format'
import { useFetch } from '../admin/hooks'
import {
  describeRange, excelRange, getSummary, invPresetRange, listPartners, validateInvRange,
  type InvRange, type PartnerFilter,
} from '../admin/investmentApi'
import { PartnerDetail } from '../admin/investmentDetail'
import { LotsPanel } from '../admin/investmentLots'
import { PartnersPanel } from '../admin/investmentPartners'
import { SummaryPanel } from '../admin/investmentSummary'
import { InvRangeBar, Section } from '../admin/investmentUi'
import { DownloadButton, DownloadResult } from '../admin/reportsUi'
import { useReportDownload } from '../admin/reportsApi'
import { Notice } from '../admin/ui'

type Tab = 'resumen' | 'entradas' | 'socios'

const tabs: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen por socio' },
  { id: 'entradas', label: 'Todas las entradas' },
  { id: 'socios', label: 'Gestionar socios' },
]

export function InvestmentView({ user }: { user: CurrentUser }) {
  const id = useId()
  const today = managuaToday()
  const canManage = hasPermission(user, 'investment.manage')
  const [tab, setTab] = useState<Tab>('resumen')
  const [range, setRangeState] = useState<InvRange>(() => invPresetRange('all', today))
  // Mientras las fechas escritas no sirvan se siguen mostrando los datos del último período válido.
  const [applied, setApplied] = useState<InvRange>(range)
  const [selected, setSelected] = useState<PartnerFilter | null>(null)
  const [entriesPartner, setEntriesPartner] = useState<PartnerFilter>('')
  const [rev, setRev] = useState(0)
  const download = useReportDownload()

  const rangeError = validateInvRange(range, today)
  const rangeText = describeRange(applied, formatIsoDate)

  function setRange(next: InvRange) {
    setRangeState(next)
    if (validateInvRange(next, today) === null) setApplied(next)
  }

  const partnersFetch = useFetch<Partner[]>(`partners|${rev}`, (signal) => listPartners('all', signal))
  const summaryFetch = useFetch<InvestmentSummary>(`summary|${applied.from}|${applied.to}|${rev}`, (signal) => getSummary(applied, signal))
  const partners = partnersFetch.data ?? []
  const summary = summaryFetch.data

  function changed() { setRev((current) => current + 1) }

  function startDownload() {
    const result = excelRange(range, today)
    if (!result.ok) { download.fail(result.message); return }
    void download.start('investment', result.range)
  }

  const excelNote = (() => {
    const result = excelRange(range, today)
    return result.ok && result.clamped ? 'El Excel admite hasta 366 días: con este rango se descargan los últimos 366 días.' : null
  })()

  function openPartner(filter: PartnerFilter) {
    setSelected(filter)
    setTab('resumen')
  }

  function goToUnassigned() {
    setEntriesPartner('none')
    setSelected(null)
    setTab('entradas')
  }

  const showRange = tab !== 'socios'

  return (
    <main className="admin-page adm-page inv-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Administración · <b className="live-data">Datos reales</b></p>
          <h1>Socios e inversión</h1>
          <p className="page-summary">Cuánto invirtió cada socio, cuánto le queda en existencias, cuánto se vendió de lo suyo y cuánta ganancia generó. Las ventas descuentan de la entrada más antigua primero. Fechas en hora de Managua.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="secondary-button" onClick={changed}>Actualizar</button>
          {showRange && <DownloadButton busy={download.state.status === 'busy'} onClick={startDownload} disabled={rangeError !== null} />}
        </div>
      </header>

      <div className="inv-download-status" aria-live="polite">
        <DownloadResult state={download.state} />
      </div>

      <nav className="catalog-tabs" role="tablist" aria-label="Secciones de socios e inversión">
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" id={`${id}-tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`${id}-panel`}
            className={tab === item.id ? 'active' : undefined} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>

      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
        {showRange && (
          <section className="panel-card adm-card inv-filter" aria-label="Período">
            <InvRangeBar value={range} onChange={setRange} today={today} />
            <p className="adm-help inv-range-help">
              El período aplica a las <b>entradas</b> y a las <b>ventas</b>. Las <b>existencias</b> siempre son las de hoy.
              {excelNote ? ` ${excelNote}` : ''}
            </p>
          </section>
        )}
        {showRange && rangeError && <Notice tone="warn"><span>{rangeError} Mientras tanto se muestran los datos del último período válido.</span></Notice>}

        {tab === 'resumen' && selected === null && (
          <SummaryPanel
            summary={summary} loading={summaryFetch.loading} error={summaryFetch.error} onRetry={summaryFetch.reload}
            onOpen={openPartner} onAssign={goToUnassigned} canManage={canManage} rangeText={rangeText} partners={partners}
          />
        )}
        {tab === 'resumen' && selected !== null && (
          <PartnerDetail
            filter={selected} partners={partners} summary={summary} range={applied} rev={rev}
            canManage={canManage} onBack={() => setSelected(null)} onChanged={changed}
          />
        )}

        {tab === 'entradas' && (
          <Section title="Todas las entradas de mercadería" hint="Cada ingreso de mercadería con su socio, costo y precio dado. Elegí «Sin socio» para asignar el socio a la mercadería que todavía no lo tiene (por ejemplo el saldo inicial).">
            <LotsPanel
              partner={entriesPartner} onPartnerChange={setEntriesPartner} partners={partners} range={applied} rev={rev}
              canManage={canManage} onChanged={changed} ariaLabel="Todas las entradas de mercadería"
            />
          </Section>
        )}

        {tab === 'socios' && (
          <PartnersPanel
            partners={partnersFetch.data} loading={partnersFetch.loading} error={partnersFetch.error}
            onRetry={partnersFetch.reload} canManage={canManage} onChanged={changed}
          />
        )}
      </div>
    </main>
  )
}
