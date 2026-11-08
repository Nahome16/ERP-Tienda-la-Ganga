import type { ImportRow } from '../lib/apiTypes'

export type Delimiter = ';' | ',' | '\t'

/** Quita el BOM UTF-8 (Excel lo agrega al guardar «CSV UTF-8»). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Detecta el delimitador mirando la primera línea fuera de comillas. Excel en
 * español guarda con «;», otros programas usan «,» o tabulador.
 */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ';': 0, ',': 0, '\t': 0 }
  let inQuotes = false
  for (const char of stripBom(text)) {
    if (char === '"') inQuotes = !inQuotes
    else if (!inQuotes && (char === '\n' || char === '\r')) break
    else if (!inQuotes && char in counts) counts[char as Delimiter] += 1
  }
  if (counts[';'] >= counts[','] && counts[';'] >= counts['\t'] && counts[';'] > 0) return ';'
  if (counts['\t'] > counts[',']) return '\t'
  return counts[','] > 0 ? ',' : ';'
}

/** Analiza CSV (RFC 4180): comillas, comillas dobles escapadas y saltos de línea dentro de campos. */
export function parseCsv(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const source = stripBom(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldStarted = false

  const endField = () => { row.push(field); field = ''; fieldStarted = false }
  const endRow = () => {
    endField()
    // Línea totalmente vacía: se ignora.
    if (!(row.length === 1 && row[0].trim() === '')) rows.push(row)
    row = []
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1 } else inQuotes = false
      } else field += char
      continue
    }
    if (char === '"' && !fieldStarted) { inQuotes = true; fieldStarted = true }
    else if (char === delimiter) endField()
    else if (char === '\r') { if (source[index + 1] === '\n') index += 1; endRow() }
    else if (char === '\n') endRow()
    else { field += char; fieldStarted = true }
  }
  if (field !== '' || fieldStarted || row.length > 0) endRow()
  return rows
}

/**
 * Convierte «1.234,50», «1,234.50», «12,5» o «12.5» en número. Devuelve null si no
 * es un número válido. Con un solo separador y 3 dígitos detrás se interpreta
 * como miles solo si hay más de un grupo («1.234.567»); «1.234» se toma como decimal.
 */
export function parseDecimal(raw: string): number | null {
  let text = raw.trim().replace(/\s+/g, '').replace(/^(C\$|US\$|\$)/i, '')
  if (text === '' || !/^-?[\d.,]+$/.test(text)) return null
  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? '.' : ','
    const thousandSep = decimalSep === '.' ? ',' : '.'
    text = text.split(thousandSep).join('').replace(decimalSep, '.')
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.'
    const parts = text.split(sep)
    if (parts.length > 2) text = parts.join('') // «1.234.567»
    else text = text.replace(sep, '.')
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

export const templateHeaders = ['Producto', 'Categoría', 'Marca', 'Corte', 'Talla', 'Color', 'Código de barras', 'Precio', 'Costo', 'Cantidad'] as const

const templateExample = [
  ['Camisa Oxford', 'Camisas', 'Bossini', 'Regular', 'M', 'Azul', '', '650', '380', '5'],
  ['Camisa Oxford', 'Camisas', 'Bossini', 'Regular', 'L', 'Azul', '', '650', '380', '3'],
  ['Pantalón Jean Slim', 'Pantalones', 'Levis', 'Slim', '32', 'Negro', '7501234567890', '1200,50', '700', '2'],
]

function escapeField(value: string): string {
  return /[;"\n\r,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Plantilla con BOM UTF-8 y «;» (la abre bien Excel en español). */
export function buildTemplateCsv(): string {
  const lines = [templateHeaders as readonly string[], ...templateExample].map((row) => row.map(escapeField).join(';'))
  return `\ufeff${lines.join('\r\n')}\r\n`
}

type Field = 'productName' | 'category' | 'brand' | 'cut' | 'size' | 'color' | 'barcode' | 'price' | 'cost' | 'quantity'

const headerAliases: Record<Field, string[]> = {
  productName: ['producto', 'nombre', 'nombredelproducto', 'product', 'articulo'],
  category: ['categoria', 'category'],
  brand: ['marca', 'brand'],
  cut: ['corte', 'cut', 'estilo'],
  size: ['talla', 'size', 'tamano'],
  color: ['color', 'colour'],
  barcode: ['codigodebarras', 'codigo', 'codbarras', 'barcode', 'ean', 'ean13', 'upc'],
  price: ['precio', 'preciodeventa', 'price', 'pvp'],
  cost: ['costo', 'cost', 'preciodecosto'],
  quantity: ['cantidad', 'existencia', 'existencias', 'stock', 'qty', 'unidades'],
}

const requiredFields: Field[] = ['productName', 'category', 'brand', 'size', 'color', 'price']
const fieldLabels: Record<Field, string> = {
  productName: 'Producto', category: 'Categoría', brand: 'Marca', cut: 'Corte', size: 'Talla',
  color: 'Color', barcode: 'Código de barras', price: 'Precio', cost: 'Costo', quantity: 'Cantidad',
}

function normalizeHeader(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export type ParsedImport = {
  delimiter: Delimiter
  /** Filas válidas y no válidas con su posición (1 = primera fila de datos). */
  rows: { row: number; data: ImportRow | null; cells: string[] }[]
  errors: { row: number; message: string }[]
  /** Errores globales (columnas que faltan, archivo vacío…). */
  fileErrors: string[]
}

const scientific = /^\d+([.,]\d+)?e[+-]?\d+$/i

/** Convierte el texto de un CSV en filas de importación, con validación por fila. */
export function parseImportCsv(text: string): ParsedImport {
  const delimiter = detectDelimiter(text)
  const table = parseCsv(text, delimiter)
  const result: ParsedImport = { delimiter, rows: [], errors: [], fileErrors: [] }
  if (table.length === 0) {
    result.fileErrors.push('El archivo está vacío.')
    return result
  }

  const headerCells = table[0].map(normalizeHeader)
  const columns = new Map<Field, number>()
  for (const field of Object.keys(headerAliases) as Field[]) {
    const index = headerCells.findIndex((cell) => headerAliases[field].includes(cell))
    if (index >= 0) columns.set(field, index)
  }
  const missing = requiredFields.filter((field) => !columns.has(field))
  if (missing.length > 0) {
    result.fileErrors.push(`Faltan columnas obligatorias: ${missing.map((field) => fieldLabels[field]).join(', ')}. Usá la plantilla para ver los nombres exactos.`)
    return result
  }

  const get = (cells: string[], field: Field) => {
    const index = columns.get(field)
    return index === undefined ? '' : (cells[index] ?? '').trim()
  }

  const barcodeRows = new Map<string, number>()
  const variantRows = new Map<string, number>()

  table.slice(1).forEach((cells, offset) => {
    const row = offset + 1
    const problems: string[] = []
    const productName = get(cells, 'productName')
    const category = get(cells, 'category')
    const brand = get(cells, 'brand')
    const size = get(cells, 'size')
    const color = get(cells, 'color')
    const cut = get(cells, 'cut')
    const barcode = get(cells, 'barcode')
    if (!productName) problems.push('Falta el producto.')
    if (!category) problems.push('Falta la categoría.')
    if (!brand) problems.push('Falta la marca.')
    if (!size) problems.push('Falta la talla.')
    if (!color) problems.push('Falta el color.')

    const price = parseDecimal(get(cells, 'price'))
    if (price === null || price <= 0) problems.push('El precio debe ser un número mayor que cero.')

    const rawCost = get(cells, 'cost')
    const cost = rawCost === '' ? null : parseDecimal(rawCost)
    if (rawCost !== '' && (cost === null || cost < 0)) problems.push('El costo debe ser un número válido (o dejalo vacío).')

    const rawQuantity = get(cells, 'quantity')
    const quantity = rawQuantity === '' ? 0 : parseDecimal(rawQuantity)
    if (quantity === null || !Number.isInteger(quantity) || quantity < 0) problems.push('La cantidad debe ser un número entero, cero o mayor.')

    if (barcode) {
      if (scientific.test(barcode)) problems.push('El código de barras está en notación científica (Excel lo recortó). Formateá la columna como Texto y volvé a escribirlo.')
      else if (/\s/.test(barcode)) problems.push('El código de barras no puede tener espacios.')
      else {
        const seen = barcodeRows.get(barcode)
        if (seen !== undefined) problems.push(`El código de barras ya aparece en la fila ${seen}.`)
        else barcodeRows.set(barcode, row)
      }
    }

    const variantKey = [productName, category, brand, size, color].map((part) => part.toLocaleLowerCase('es')).join('|')
    const seenVariant = variantRows.get(variantKey)
    if (productName && size && color) {
      if (seenVariant !== undefined) problems.push(`Esta talla y color ya aparecen para el mismo producto en la fila ${seenVariant}.`)
      else variantRows.set(variantKey, row)
    }

    if (problems.length > 0) {
      result.errors.push({ row, message: problems.join(' ') })
      result.rows.push({ row, data: null, cells })
      return
    }
    result.rows.push({
      row,
      cells,
      data: {
        productName, category, brand, cut: cut || null, size, color,
        barcode: barcode || null,
        price: price as number,
        cost,
        quantity: quantity as number,
      },
    })
  })

  if (result.rows.length === 0) result.fileErrors.push('El archivo no tiene filas de datos debajo del encabezado.')
  return result
}
