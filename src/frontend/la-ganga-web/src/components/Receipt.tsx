import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import type { Sale, StoreSettings } from '../lib/apiTypes'
import { formatNio, formatUsd } from '../lib/money'
import './receipt.css'

type ReceiptProps = { sale: Sale; settings: StoreSettings }

const methodLabel = { Cash: 'Efectivo', Transfer: 'Transferencia', Card: 'Tarjeta (POS)' } as const

/** Recibo interno (no fiscal, sin desglose de impuestos). Pensado para papel térmico de 80 mm. */
export function Receipt({ sale, settings }: ReceiptProps) {
  const date = new Intl.DateTimeFormat('es-NI', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Managua',
  }).format(new Date(sale.createdAtUtc))
  return (
    <div className="receipt-sheet">
      <h1>{settings.storeName}</h1>
      {settings.storeAddress && <div className="receipt-center">{settings.storeAddress}</div>}
      {settings.storePhone && <div className="receipt-center">Tel. {settings.storePhone}</div>}
      <hr className="receipt-rule" />
      <div className="receipt-row"><span>Recibo</span><strong>{sale.number}</strong></div>
      <div className="receipt-row"><span>Fecha</span><span>{date}</span></div>
      <div className="receipt-row"><span>{sale.registerName}</span><span>{sale.sellerName}</span></div>
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
      {sale.changeNio > 0 && <div className="receipt-row"><span>Cambio</span><span>{formatNio(sale.changeNio)}</span></div>}
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
