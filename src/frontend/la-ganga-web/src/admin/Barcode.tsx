import { barRuns, barcodeModules, normalizeBarcode } from './ean13'

/** Código de barras EAN-13/EAN-8 como SVG. Si el texto no es EAN válido, muestra solo el número. */
export function Barcode({ code }: { code: string }) {
  const normalized = normalizeBarcode(code)
  if (!normalized) return <div className="label-unreadable">{code}<br />(sin barras: no es EAN)</div>
  const { digits, kind } = normalized
  const modules = barcodeModules(digits)
  const quiet = 9
  const width = modules.length + quiet * 2
  const barHeight = 52
  const guardHeight = 58
  const guards: [number, number][] = kind === 'EAN-13'
    ? [[0, 3], [45, 50], [92, 95]]
    : [[0, 3], [31, 36], [64, 67]]
  const isGuard = (position: number) => guards.some(([from, to]) => position >= from && position < to)
  const leftStart = quiet + 3
  const rightStart = quiet + (kind === 'EAN-13' ? 50 : 36)
  const leftDigits = kind === 'EAN-13' ? digits.slice(1, 7) : digits.slice(0, 4)
  const rightDigits = kind === 'EAN-13' ? digits.slice(7) : digits.slice(4)
  return (
    <svg viewBox={`0 0 ${width} 68`} role="img" aria-label={`Código de barras ${digits}`} preserveAspectRatio="xMidYMid meet" shapeRendering="crispEdges">
      <rect width={width} height="68" fill="#fff" />
      {barRuns(modules).map(([position, runWidth]) => (
        <rect key={position} x={quiet + position} y="0" width={runWidth} height={isGuard(position) ? guardHeight : barHeight} fill="#000" />
      ))}
      <g fontFamily="Arial, Helvetica, sans-serif" fontSize="8.5" textAnchor="middle" fill="#000">
        {kind === 'EAN-13' && <text x={quiet - 4} y="66">{digits[0]}</text>}
        {leftDigits.split('').map((digit, index) => <text key={`l${index}`} x={leftStart + index * 7 + 3.5} y="66">{digit}</text>)}
        {rightDigits.split('').map((digit, index) => <text key={`r${index}`} x={rightStart + index * 7 + 3.5} y="66">{digit}</text>)}
      </g>
    </svg>
  )
}
