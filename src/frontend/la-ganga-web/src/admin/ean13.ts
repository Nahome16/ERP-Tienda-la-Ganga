// Código de barras EAN-13 (también UPC-A y EAN-8) generado sin librerías.

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const R = L.map((pattern) => pattern.replace(/[01]/g, (bit) => (bit === '0' ? '1' : '0')))
const G = R.map((pattern) => pattern.split('').reverse().join(''))
const parity = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/** Dígito de verificación para los primeros 12 (EAN-13) u 7 (EAN-8) dígitos. */
export function checkDigit(body: string): number {
  if (!/^\d+$/.test(body)) throw new Error('El código solo puede tener dígitos.')
  let sum = 0
  // Desde la derecha, el primer dígito pesa 3, el siguiente 1, y así.
  for (let index = 0; index < body.length; index += 1) {
    const digit = Number(body[body.length - 1 - index])
    sum += index % 2 === 0 ? digit * 3 : digit
  }
  return (10 - (sum % 10)) % 10
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && checkDigit(code.slice(0, 12)) === Number(code[12])
}

export function isValidEan8(code: string): boolean {
  return /^\d{8}$/.test(code) && checkDigit(code.slice(0, 7)) === Number(code[7])
}

/** Completa 12 dígitos con su dígito de verificación. */
export function withCheckDigit(body12: string): string {
  return `${body12}${checkDigit(body12)}`
}

export type BarcodeKind = 'EAN-13' | 'EAN-8'

/** Normaliza el texto de un código a EAN-13/EAN-8 si es posible (UPC-A de 12 dígitos se antepone 0). */
export function normalizeBarcode(code: string): { kind: BarcodeKind; digits: string } | null {
  const trimmed = code.trim()
  if (isValidEan13(trimmed)) return { kind: 'EAN-13', digits: trimmed }
  if (/^\d{12}$/.test(trimmed) && isValidEan13(`0${trimmed}`)) return { kind: 'EAN-13', digits: `0${trimmed}` }
  if (isValidEan8(trimmed)) return { kind: 'EAN-8', digits: trimmed }
  return null
}

/** Cadena de módulos «0/1» (1 = barra negra) sin zonas de silencio: 95 para EAN-13 y 67 para EAN-8. */
export function barcodeModules(digits: string): string {
  if (isValidEan13(digits)) {
    const first = Number(digits[0])
    let bits = '101'
    for (let index = 0; index < 6; index += 1) {
      const digit = Number(digits[index + 1])
      bits += parity[first][index] === 'L' ? L[digit] : G[digit]
    }
    bits += '01010'
    for (let index = 7; index < 13; index += 1) bits += R[Number(digits[index])]
    return `${bits}101`
  }
  if (isValidEan8(digits)) {
    let bits = '101'
    for (let index = 0; index < 4; index += 1) bits += L[Number(digits[index])]
    bits += '01010'
    for (let index = 4; index < 8; index += 1) bits += R[Number(digits[index])]
    return `${bits}101`
  }
  throw new Error('Código EAN no válido.')
}

/** Tramos de barras negras contiguas como [posición, ancho] en módulos. */
export function barRuns(modules: string): [number, number][] {
  const runs: [number, number][] = []
  let start = -1
  for (let index = 0; index <= modules.length; index += 1) {
    const black = modules[index] === '1'
    if (black && start < 0) start = index
    if (!black && start >= 0) { runs.push([start, index - start]); start = -1 }
  }
  return runs
}
