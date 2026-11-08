import type { CashSummary } from '../lib/apiTypes'
import { formatNio, formatUsd } from '../lib/money'
import type { SlipData } from './CashSlip'
import { formatDateTime } from './format'
import { methodsFromSummary } from './reconciliation'

export function printCashSlip() {
  document.body.classList.add('printing-cash')
  const cleanup = () => {
    document.body.classList.remove('printing-cash')
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
}

export function slipFromSummary(storeName: string, summary: CashSummary): SlipData {
  const { session } = summary
  return {
    storeName,
    title: `Cierre de ${session.registerName}`,
    meta: [
      ['Cajero', session.openedByName],
      ['Apertura', formatDateTime(session.openedAtUtc)],
      ['Cierre', session.closedAtUtc ? formatDateTime(session.closedAtUtc) : 'Caja abierta'],
      ['Fondo inicial', `${formatNio(session.openingFloatNio)} / ${formatUsd(session.openingFloatUsd)}`],
    ],
    totals: summary.totals,
    methods: methodsFromSummary(summary),
    open: session.closedAtUtc === null,
    notes: session.closingNotes,
  }
}
