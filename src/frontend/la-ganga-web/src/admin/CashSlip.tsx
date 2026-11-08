import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import type { CashTotals } from '../lib/apiTypes'
import { formatNio, formatUsd } from '../lib/money'
import { channelLabels } from './format'

export type SlipData = {
  storeName: string
  title: string
  meta: [string, string][]
  totals: CashTotals
  expectedNio: number
  expectedUsd: number
  countedNio: number | null
  countedUsd: number | null
  notes?: string | null
  /** Una línea por caja (solo cierre del día). */
  registers?: { name: string; detail: string; totalNio: number }[]
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="slip-row"><span>{label}</span><span>{value}</span></div>
}

function differenceText(counted: number | null, expected: number, format: (value: number) => string) {
  if (counted === null) return 'Pendiente'
  const diff = Math.round((counted - expected) * 100) / 100
  if (diff === 0) return 'Cuadra'
  return `${diff > 0 ? 'Sobra' : 'Falta'} ${format(Math.abs(diff))}`
}

/** Cierre de caja en formato 80 mm. Solo se ve al imprimir (clase printing-cash). */
export function CashSlip({ data }: { data: SlipData }) {
  const { totals } = data
  return (
    <div className="cash-slip">
      <h1>{data.storeName}</h1>
      <div className="slip-center"><strong>{data.title}</strong></div>
      <hr className="slip-rule" />
      {data.meta.map(([label, value]) => <Row key={label} label={label} value={value} />)}
      <hr className="slip-rule" />
      {data.registers && data.registers.length > 0 && (
        <>
          <h2>Cajas</h2>
          {data.registers.map((register) => (
            <div key={register.name}>
              <Row label={register.name} value={formatNio(register.totalNio)} />
              <div style={{ fontSize: 11 }}>{register.detail}</div>
            </div>
          ))}
          <hr className="slip-rule" />
        </>
      )}
      <h2>Ventas</h2>
      <Row label="Ventas" value={String(totals.salesCount)} />
      <Row label="Anuladas" value={`${totals.voidedCount} (${formatNio(totals.voidedTotalNio)})`} />
      <Row label="Total bruto" value={formatNio(totals.grossTotalNio)} />
      <Row label="Descuentos" value={`−${formatNio(totals.discountTotalNio)}`} />
      <div className="slip-row slip-total"><span>TOTAL VENDIDO</span><span>{formatNio(totals.netTotalNio)}</span></div>
      <hr className="slip-rule" />
      <h2>Por método</h2>
      <Row label="Efectivo (neto)" value={formatNio(totals.cashTotalNio)} />
      <Row label="Transferencia" value={formatNio(totals.transferTotalNio)} />
      {totals.transfersByBank.map((bank) => <Row key={bank.bank} label={`  ${bank.bank}`} value={formatNio(bank.totalNio)} />)}
      <Row label="POS / Tarjeta" value={formatNio(totals.cardTotalNio)} />
      {totals.byChannel.length > 0 && (
        <>
          <h2>Por canal</h2>
          {totals.byChannel.map((channel) => <Row key={channel.channel} label={`${channelLabels[channel.channel] ?? channel.channel} (${channel.salesCount})`} value={formatNio(channel.totalNio)} />)}
        </>
      )}
      <hr className="slip-rule" />
      <h2>Efectivo</h2>
      <Row label="C$ recibidos" value={formatNio(totals.cashNioTendered)} />
      <Row label="US$ recibidos" value={formatUsd(totals.cashUsdTendered)} />
      <Row label="Cambio entregado" value={formatNio(totals.changeGivenNio)} />
      <Row label="Esperado C$" value={formatNio(data.expectedNio)} />
      <Row label="Contado C$" value={data.countedNio === null ? 'Pendiente' : formatNio(data.countedNio)} />
      <Row label="Diferencia C$" value={differenceText(data.countedNio, data.expectedNio, formatNio)} />
      <Row label="Esperado US$" value={formatUsd(data.expectedUsd)} />
      <Row label="Contado US$" value={data.countedUsd === null ? 'Pendiente' : formatUsd(data.countedUsd)} />
      <Row label="Diferencia US$" value={differenceText(data.countedUsd, data.expectedUsd, formatUsd)} />
      {data.notes && <><hr className="slip-rule" /><div>Notas: {data.notes}</div></>}
      <hr className="slip-rule" />
      <div style={{ marginTop: 28 }} className="slip-center">______________________<br />Firma</div>
    </div>
  )
}

export function PrintableCashSlip({ data }: { data: SlipData }) {
  useEffect(() => () => document.body.classList.remove('printing-cash'), [])
  return createPortal(<div className="cash-print-root"><CashSlip data={data} /></div>, document.body)
}
