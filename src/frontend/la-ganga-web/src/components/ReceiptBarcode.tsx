import { code128Bars } from '../lib/code128'

/** Número del recibo como código de barras (Code 128), para escanearlo en «Cambio de talla». */
export function ReceiptBarcode({ number }: { number: string }) {
  const { bars, width } = code128Bars(number)
  const quiet = 10
  const total = width + quiet * 2
  return (
    <svg className="receipt-barcode" viewBox={`0 0 ${total} 40`} role="img" aria-label={`Código de barras del recibo ${number}`} preserveAspectRatio="none" shapeRendering="crispEdges">
      <rect width={total} height="40" fill="#fff" />
      {bars.map(([position, size]) => <rect key={position} x={quiet + position} y="0" width={size} height="40" fill="#000" />)}
    </svg>
  )
}
