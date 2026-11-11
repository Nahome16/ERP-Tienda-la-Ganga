import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import type { CashSummary, Exchange, Sale, StoreSettings } from '../lib/apiTypes'
import { formatNio, formatUsd } from '../lib/money'
import { diffText, reconciliationRows, visibleRows } from '../pos/reconcile'
import { ReceiptBarcode } from './ReceiptBarcode'
import { ReceiptLogo } from './ReceiptLogo'
import './receipt.css'

type ReceiptProps = { sale: Sale; settings: StoreSettings }

const methodLabel = { Cash: 'Efectivo', Transfer: 'Transferencia', Card: 'Tarjeta (POS)' } as const
const channelNames = { Store: 'Tienda', WhatsApp: 'WhatsApp', Facebook: 'Facebook' } as const

/** Política de cambios impresa en el recibo, según los días configurados. */
function exchangePolicy(days: number | undefined) {
  if (days === undefined || days < 0) return 'Cambios de talla o color con este recibo.'
  if (days === 0) return 'Cambios de talla o color solo el mismo día, con este recibo.'
  return `Cambios de talla o color dentro de ${days} día${days === 1 ? '' : 's'} con este recibo.`
}

/** El pie escrito en Configuración ya explica los cambios: no se repite la política automática. */
function mentionsExchanges(footer: string | undefined) {
  return /cambio|devoluci/i.test(footer ?? '')
}

/** Recibo de venta (sin desglose de impuestos). Pensado para papel térmico de 80 mm. */
export function Receipt({ sale, settings }: ReceiptProps) {
  const date = new Intl.DateTimeFormat('es-NI', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Managua',
  }).format(new Date(sale.createdAtUtc))
  const isProvisional = sale.number.startsWith('#')
  return (
    <div className="receipt-sheet">
      <ReceiptLogo />
      <h1>{settings.storeName}</h1>
      {settings.storeAddress && <div className="receipt-center">{settings.storeAddress}</div>}
      {settings.storePhone && <div className="receipt-center">Tel. {settings.storePhone}</div>}
      <hr className="receipt-rule" />
      <div className="receipt-center receipt-title">RECIBO DE VENTA</div>
      <div className="receipt-row"><span>N.º</span><strong>{sale.number}</strong></div>
      {isProvisional && <div className="receipt-center receipt-small">Referencia provisional: el número oficial se asigna al sincronizar.</div>}
      <div className="receipt-row"><span>Fecha</span><span>{date}</span></div>
      <div className="receipt-row"><span>{sale.registerName}</span><span>{sale.sellerName}</span></div>
      {sale.customerName && <div className="receipt-row"><span>Cliente</span><span>{sale.customerName}</span></div>}
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
      {!mentionsExchanges(settings.receiptFooter) && <div className="receipt-center receipt-small">{exchangePolicy(settings.exchangeWindowDays)}</div>}
      {settings.receiptFooter && <div className="receipt-center">{settings.receiptFooter}</div>}
      <div className="receipt-center receipt-bold">¡Gracias por su compra!</div>
      {!isProvisional && (
        <div className="receipt-barcode-box">
          <ReceiptBarcode number={sale.number} />
        </div>
      )}
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

type ExchangeSheetProps = { exchange: Exchange; settings: StoreSettings }

/** Comprobante de cambio de talla o color (80 mm). No mueve dinero: la prenda nueva conserva el precio pagado. */
export function ExchangeSheet({ exchange, settings }: ExchangeSheetProps) {
  const units = exchange.lines.reduce((sum, line) => sum + line.quantity, 0)
  return (
    <div className="receipt-sheet">
      <ReceiptLogo />
      {settings.storeAddress && <div className="receipt-center">{settings.storeAddress}</div>}
      {settings.storePhone && <div className="receipt-center">Tel. {settings.storePhone}</div>}
      <hr className="receipt-rule" />
      <div className="receipt-center receipt-title">COMPROBANTE DE CAMBIO</div>
      <div className="receipt-row"><span>N.º</span><strong>{exchange.number}</strong></div>
      <div className="receipt-row"><span>Recibo original</span><strong>{exchange.saleNumber}</strong></div>
      <div className="receipt-row"><span>Fecha</span><span>{formatStamp(exchange.createdAtUtc)}</span></div>
      <div className="receipt-row"><span>{exchange.registerName ?? 'Tienda'}</span><span>{exchange.userName}</span></div>
      <hr className="receipt-rule" />
      {exchange.lines.map((line, index) => (
        <div className="receipt-line" key={`${line.returnedBarcode}-${line.newBarcode}-${index}`}>
          <div className="receipt-line-name">{line.quantity} × {line.productName}</div>
          <div className="receipt-row receipt-small"><span>Devuelve</span><span>{line.returnedSizeName} · {line.returnedColorName}</span></div>
          <div className="receipt-row receipt-small"><span>Se lleva</span><span>{line.newSizeName} · {line.newColorName}</span></div>
        </div>
      ))}
      <hr className="receipt-rule" />
      <div className="receipt-row receipt-bold"><span>Prendas cambiadas</span><span>{units}</span></div>
      <div className="receipt-row"><span>Diferencia a pagar</span><span>{formatNio(0)}</span></div>
      {exchange.note && <div className="receipt-center receipt-small">{exchange.note}</div>}
      <hr className="receipt-rule" />
      <div className="receipt-center receipt-small">Conserve este comprobante junto con su recibo.</div>
      <div className="receipt-center receipt-bold">¡Gracias por su compra!</div>
    </div>
  )
}

export function PrintableExchange({ exchange, settings }: ExchangeSheetProps) {
  useEffect(() => () => document.body.classList.remove('printing-receipt'), [])
  return createPortal(<div className="receipt-print-root"><ExchangeSheet exchange={exchange} settings={settings} /></div>, document.body)
}

type CashSummaryProps = { summary: CashSummary; storeName: string }

function formatStamp(iso: string | null) {
  return iso
    ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Managua' }).format(new Date(iso))
    : '—'
}

const reconCurrency = { NIO: formatNio, USD: formatUsd } as const
const reconName = { NIO: 'Córdobas', USD: 'Dólares' } as const
const reconSection = { Cash: 'ARQUEO DE EFECTIVO', Transfer: 'TRANSFERENCIAS (BANCO)', Card: 'TARJETA (LOTE TERMINAL)' } as const

/** Resumen de cierre de caja para papel térmico de 80 mm. */
export function CashSummarySheet({ summary, storeName }: CashSummaryProps) {
  const { session, totals } = summary
  const rows = visibleRows(reconciliationRows(summary))
  const methods = ['Cash', 'Transfer', 'Card'] as const
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
      <div className="receipt-center"><strong>VENDIDO POR METODO</strong></div>
      <div className="receipt-row receipt-bold"><span>Efectivo (neto)</span><span>{formatNio(totals.cashTotalNio)}</span></div>
      <div className="receipt-row receipt-small receipt-ind"><span>Recibido C$</span><span>{formatNio(totals.cashNioTendered)}</span></div>
      {totals.cashUsdTendered > 0 && <div className="receipt-row receipt-small receipt-ind"><span>Recibido US$</span><span>{formatUsd(totals.cashUsdTendered)}</span></div>}
      {totals.changeGivenNio > 0 && <div className="receipt-row receipt-small receipt-ind"><span>Cambio dado</span><span>−{formatNio(totals.changeGivenNio)}</span></div>}
      <div className="receipt-row receipt-bold"><span>Transferencias</span><span>{formatNio(totals.transferTotalNio)}</span></div>
      {totals.transferNioTendered > 0 && <div className="receipt-row receipt-small receipt-ind"><span>En C$</span><span>{formatNio(totals.transferNioTendered)}</span></div>}
      {totals.transferUsdTendered > 0 && <div className="receipt-row receipt-small receipt-ind"><span>En US$</span><span>{formatUsd(totals.transferUsdTendered)}</span></div>}
      {totals.transfersByBank.map((item) => (
        <div className="receipt-row receipt-small" key={item.bank}>
          <span>{item.bank}</span><span>{formatNio(item.totalNio)}{item.totalUsd > 0 ? ` (${formatUsd(item.totalUsd)})` : ''}</span>
        </div>
      ))}
      <div className="receipt-row receipt-bold"><span>Tarjeta (POS)</span><span>{formatNio(totals.cardTotalNio)}</span></div>
      {totals.cardNioTendered > 0 && <div className="receipt-row receipt-small receipt-ind"><span>En C$</span><span>{formatNio(totals.cardNioTendered)}</span></div>}
      {totals.cardUsdTendered > 0 && <div className="receipt-row receipt-small receipt-ind"><span>En US$</span><span>{formatUsd(totals.cardUsdTendered)}</span></div>}
      <hr className="receipt-rule" />
      <div className="receipt-center"><strong>CONCILIACION</strong></div>
      {methods.map((method) => {
        const group = rows.filter((row) => row.method === method)
        return (
          <div key={method}>
            <div className="receipt-bold receipt-section">{reconSection[method]}</div>
            {group.length === 0 && <div className="receipt-small">Sin movimientos</div>}
            {group.map((row) => {
              const format = reconCurrency[row.currency]
              return (
                <div key={row.currency} className="receipt-recon">
                  <div>{reconName[row.currency]}</div>
                  <div className="receipt-row receipt-ind"><span>Esperado</span><span>{format(row.expected)}</span></div>
                  <div className="receipt-row receipt-ind"><span>Verificado</span><span>{row.counted === null ? 'No verificado' : format(row.counted)}</span></div>
                  {row.counted !== null && <div className="receipt-row receipt-bold receipt-ind"><span>Diferencia</span><span>{diffText(row.difference, format)}</span></div>}
                </div>
              )
            })}
          </div>
        )
      })}
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
