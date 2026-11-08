import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import type { CashSummary, Sale, StoreSettings } from '../lib/apiTypes'
import { formatNio, formatUsd } from '../lib/money'
import './receipt.css'

type ReceiptProps = { sale: Sale; settings: StoreSettings }

const methodLabel = { Cash: 'Efectivo', Transfer: 'Transferencia', Card: 'Tarjeta (POS)' } as const
const channelNames = { Store: 'Tienda', WhatsApp: 'WhatsApp', Facebook: 'Facebook' } as const

/** Recibo interno (no fiscal, sin desglose de impuestos). Pensado para papel térmico de 80 mm. */
export function Receipt({ sale, settings }: ReceiptProps) {
  const date = new Intl.DateTimeFormat('es-NI', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Managua',
  }).format(new Date(sale.createdAtUtc))
  const isProvisional = sale.number.startsWith('#')
  return (
    <div className="receipt-sheet">
      <h1>{settings.storeName}</h1>
      {settings.storeAddress && <div className="receipt-center">{settings.storeAddress}</div>}
      {settings.storePhone && <div className="receipt-center">Tel. {settings.storePhone}</div>}
      <hr className="receipt-rule" />
      <div className="receipt-row"><span>Recibo</span><strong>{sale.number}</strong></div>
      {isProvisional && <div className="receipt-center receipt-small">Referencia provisional: el número oficial se asigna al sincronizar.</div>}
      <div className="receipt-row"><span>Fecha</span><span>{date}</span></div>
      <div className="receipt-row"><span>{sale.registerName}</span><span>{sale.sellerName}</span></div>
      {sale.channel !== 'Store' && <div className="receipt-row"><span>Canal</span><span>{channelNames[sale.channel]}</span></div>}
      {sale.status === 'Voided' && <div className="receipt-center"><strong>*** ANULADO ***</strong></div>}
      <hr className="receipt-rule" />
      {sale.lines.map((line) => (
        <div key={`${line.variantId}-${line.unitPrice}`}>
          <div className="receipt-line-name">{line.productName}</div>
          <div className="receipt-row">
            <span>{line.quantity} × {formatNio(line.unitPrice)} · {line.sizeName} / {line.colorName}</span>
            <span>{formatNio(line.lineTotalNio)}</span>
          </div>
        </div>
      ))}
      <hr className="receipt-rule" />
      <div className="receipt-row"><span>Subtotal</span><span>{formatNio(sale.subtotalNio)}</span></div>
      {sale.discountNio > 0 && (
        <div className="receipt-row">
          <span>Descuento{sale.discountType === 'Percent' && sale.discountValue !== null ? ` ${sale.discountValue}%` : ''}</span>
          <span>−{formatNio(sale.discountNio)}</span>
        </div>
      )}
      <div className="receipt-row receipt-total"><span>TOTAL</span><span>{formatNio(sale.totalNio)}</span></div>
      <hr className="receipt-rule" />
      {sale.payments.map((payment, index) => (
        <div className="receipt-row" key={`${payment.method}-${index}`}>
          <span>{methodLabel[payment.method]}{payment.bank ? ` (${payment.bank})` : ''}</span>
          <span>{payment.currency === 'USD' ? `${formatUsd(payment.amount)} @ ${payment.exchangeRate}` : formatNio(payment.amount)}</span>
        </div>
      ))}
      {sale.changeNio > 0 && <div className="receipt-row receipt-bold"><span>Cambio</span><span>{formatNio(sale.changeNio)}</span></div>}
      <hr className="receipt-rule" />
      <div className="receipt-center">{settings.receiptFooter || 'Recibo interno — no es factura'}</div>
      <div className="receipt-center">¡Gracias por su compra!</div>
    </div>
  )
}

/**
 * Imprime el recibo mostrado con <PrintableReceipt>. Usa el cuadro de
 * impresión del navegador (en la caja: impresora térmica predeterminada).
 */
export function printReceipt() {
  document.body.classList.add('printing-receipt')
  const cleanup = () => {
    document.body.classList.remove('printing-receipt')
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
}

/** Monta el recibo fuera de la app (solo visible al imprimir). */
export function PrintableReceipt({ sale, settings }: ReceiptProps) {
  useEffect(() => () => document.body.classList.remove('printing-receipt'), [])
  return createPortal(<div className="receipt-print-root"><Receipt sale={sale} settings={settings} /></div>, document.body)
}

type CashSummaryProps = { summary: CashSummary; storeName: string }

function formatStamp(iso: string | null) {
  return iso
    ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Managua' }).format(new Date(iso))
    : '—'
}

/** Resumen de cierre de caja para papel térmico de 80 mm. */
export function CashSummarySheet({ summary, storeName }: CashSummaryProps) {
  const { session, totals } = summary
  const diff = (value: number | null, format: (amount: number) => string) => value === null ? '—' : `${value > 0 ? '+' : ''}${format(value)}`
  return (
    <div className="receipt-sheet">
      <h1>{storeName}</h1>
      <div className="receipt-center"><strong>CIERRE DE CAJA</strong></div>
      <hr className="receipt-rule" />
      <div className="receipt-row"><span>Caja</span><span>{session.registerName}</span></div>
      <div className="receipt-row"><span>Cajero/a</span><span>{session.openedByName}</span></div>
      <div className="receipt-row"><span>Apertura</span><span>{formatStamp(session.openedAtUtc)}</span></div>
      <div className="receipt-row"><span>Cierre</span><span>{formatStamp(session.closedAtUtc)}</span></div>
      <hr className="receipt-rule" />
      <div className="receipt-row"><span>Ventas</span><span>{totals.salesCount}</span></div>
      <div className="receipt-row"><span>Anuladas</span><span>{totals.voidedCount} ({formatNio(totals.voidedTotalNio)})</span></div>
      <div className="receipt-row"><span>Venta bruta</span><span>{formatNio(totals.grossTotalNio)}</span></div>
      <div className="receipt-row"><span>Descuentos</span><span>−{formatNio(totals.discountTotalNio)}</span></div>
      <div className="receipt-row receipt-total"><span>TOTAL VENDIDO</span><span>{formatNio(totals.netTotalNio)}</span></div>
      <hr className="receipt-rule" />
      <div className="receipt-row"><span>Efectivo (neto)</span><span>{formatNio(totals.cashTotalNio)}</span></div>
      <div className="receipt-row"><span>Transferencias</span><span>{formatNio(totals.transferTotalNio)}</span></div>
      {totals.transfersByBank.map((item) => (
        <div className="receipt-row receipt-small" key={item.bank}><span>  {item.bank}</span><span>{formatNio(item.totalNio)}</span></div>
      ))}
      <div className="receipt-row"><span>Tarjeta (POS)</span><span>{formatNio(totals.cardTotalNio)}</span></div>
      <hr className="receipt-rule" />
      <div className="receipt-center"><strong>ARQUEO</strong></div>
      <div className="receipt-row"><span>C$ esperado</span><span>{formatNio(summary.expectedCashNio)}</span></div>
      <div className="receipt-row"><span>C$ contado</span><span>{session.countedCashNio === null ? '—' : formatNio(session.countedCashNio)}</span></div>
      <div className="receipt-row receipt-bold"><span>Diferencia C$</span><span>{diff(summary.differenceCashNio, formatNio)}</span></div>
      <div className="receipt-row"><span>US$ esperado</span><span>{formatUsd(summary.expectedCashUsd)}</span></div>
      <div className="receipt-row"><span>US$ contado</span><span>{session.countedCashUsd === null ? '—' : formatUsd(session.countedCashUsd)}</span></div>
      <div className="receipt-row receipt-bold"><span>Diferencia US$</span><span>{diff(summary.differenceCashUsd, formatUsd)}</span></div>
      {session.closingNotes && (<><hr className="receipt-rule" /><div>Notas: {session.closingNotes}</div></>)}
      {totals.reviewCount > 0 && <div className="receipt-center receipt-small">{totals.reviewCount} venta(s) con revisión pendiente</div>}
      <hr className="receipt-rule" />
      <div className="receipt-row receipt-sign"><span>Firma: ______________</span></div>
    </div>
  )
}

/** Monta el resumen de cierre fuera de la app (solo visible al imprimir). Usar con printReceipt(). */
export function PrintableCashSummary(props: CashSummaryProps) {
  useEffect(() => () => document.body.classList.remove('printing-receipt'), [])
  return createPortal(<div className="receipt-print-root"><CashSummarySheet {...props} /></div>, document.body)
}
