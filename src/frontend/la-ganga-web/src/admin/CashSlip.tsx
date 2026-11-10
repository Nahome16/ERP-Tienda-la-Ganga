import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import type { CashTotals } from '../lib/apiTypes'
import { formatNio, formatUsd } from '../lib/money'
import { channelLabels } from './format'
import { currencyNames, formatMoney, lineCountedText, lineDifferenceText, type RecMethod } from './reconciliation'

export type SlipData = {
  storeName: string
  title: string
  meta: [string, string][]
  totals: CashTotals
  /** Esperado vs verificado por método y moneda. */
  methods: RecMethod[]
  /** Hay cajas abiertas: lo verificado todavía no aplica. */
  open: boolean
  notes?: string | null
  /** Una línea por caja (solo cierre del día). */
  registers?: { name: string; detail: string; totalNio: number }[]
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="slip-row"><span>{label}</span><span>{value}</span></div>
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
          {data.registers.map((register, index) => (
            <div key={`${register.name}-${index}`}>
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
      <h2>Por método (en C$)</h2>
      <Row label="Efectivo (neto)" value={formatNio(totals.cashTotalNio)} />
      <Row label="Transferencia" value={formatNio(totals.transferTotalNio)} />
      {totals.transfersByBank.map((bank) => (
        <Row key={bank.bank} label={`  ${bank.bank}`} value={bank.totalUsd > 0 ? `${formatNio(bank.totalNio)} (${formatUsd(bank.totalUsd)})` : formatNio(bank.totalNio)} />
      ))}
      <Row label="POS / Tarjeta" value={formatNio(totals.cardTotalNio)} />
      {totals.byChannel.length > 0 && (
        <>
          <h2>Por canal</h2>
          {totals.byChannel.map((channel) => <Row key={channel.channel} label={`${channelLabels[channel.channel] ?? channel.channel} (${channel.salesCount})`} value={formatNio(channel.totalNio)} />)}
        </>
      )}
      <hr className="slip-rule" />
      <h2>Recibido</h2>
      <Row label="Efectivo C$" value={formatNio(totals.cashNioTendered)} />
      <Row label="Efectivo US$" value={formatUsd(totals.cashUsdTendered)} />
      <Row label="Cambio entregado" value={formatNio(totals.changeGivenNio)} />
      <Row label="Transfer. C$" value={formatNio(totals.transferNioTendered)} />
      <Row label="Transfer. US$" value={formatUsd(totals.transferUsdTendered)} />
      <Row label="Tarjeta C$" value={formatNio(totals.cardNioTendered)} />
      <Row label="Tarjeta US$" value={formatUsd(totals.cardUsdTendered)} />
      {data.methods.map((method) => (
        <div key={method.key} className="slip-method">
          <hr className="slip-rule" />
          <h2>{method.title}: esperado vs verificado</h2>
          {method.lines.map((entry) => (
            <div key={entry.currency}>
              <div className="slip-sub">{currencyNames[entry.currency]}</div>
              <Row label="Esperado" value={formatMoney(entry.currency, entry.expected)} />
              <Row label={method.key === 'cash' ? 'Contado' : method.key === 'transfer' ? 'Banco' : 'Terminal'} value={lineCountedText(entry, data.open)} />
              <Row label="Diferencia" value={lineDifferenceText(entry, data.open)} />
            </div>
          ))}
        </div>
      ))}
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
