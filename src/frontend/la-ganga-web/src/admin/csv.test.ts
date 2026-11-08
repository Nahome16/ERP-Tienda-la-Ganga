import { describe, expect, it } from 'vitest'
import { buildTemplateCsv, detectDelimiter, parseCsv, parseDecimal, parseImportCsv, prepareImportRows, templateHeaders, templateHeadersWithPartner } from './csv'

describe('parseDecimal', () => {
  it('acepta coma o punto decimal y separadores de miles', () => {
    expect(parseDecimal('12,5')).toBe(12.5)
    expect(parseDecimal('12.5')).toBe(12.5)
    expect(parseDecimal('1.234,50')).toBe(1234.5)
    expect(parseDecimal('1,234.50')).toBe(1234.5)
    expect(parseDecimal('1.234.567')).toBe(1234567)
    expect(parseDecimal('C$ 650')).toBe(650)
  })
  it('rechaza texto', () => {
    expect(parseDecimal('abc')).toBeNull()
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('12a')).toBeNull()
  })
})

describe('parseCsv', () => {
  it('detecta ; y , y quita el BOM', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(parseCsv('﻿a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('maneja comillas, comillas escapadas, saltos dentro del campo y CRLF', () => {
    const rows = parseCsv('a;b\r\n"x;y";"di ""hola"""\r\n"l1\nl2";z\r\n')
    expect(rows).toEqual([['a', 'b'], ['x;y', 'di "hola"'], ['l1\nl2', 'z']])
  })
  it('ignora líneas vacías', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('parseImportCsv', () => {
  it('lee la plantilla sin errores', () => {
    const result = parseImportCsv(buildTemplateCsv())
    expect(result.fileErrors).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(3)
    expect(result.rows[2].data).toMatchObject({ productName: 'Pantalón Jean Slim', price: 1200.5, quantity: 2, barcode: '7501234567890' })
    expect(result.rows[0].data?.barcode).toBeNull()
  })
  it('acepta cabeceras con otras mayúsculas/acentos y coma como delimitador', () => {
    const csv = 'PRODUCTO,categoria,MARCA,Talla,Color,Precio\nCamisa,Camisas,X,M,Azul,"1,5"\n'
    const result = parseImportCsv(csv)
    expect(result.delimiter).toBe(',')
    expect(result.errors).toEqual([])
    expect(result.rows[0].data).toMatchObject({ price: 1.5, quantity: 0, cost: null, cut: null })
  })
  it('informa errores por fila', () => {
    const csv = [
      templateHeaders.join(';'),
      'Camisa;Camisas;X;;M;Azul;123;abc;;1',
      'Camisa;Camisas;X;;M;Azul;123;10;;-2',
      'Camisa;Camisas;X;;L;Azul;1,2E+12;10;;2',
      ';;;;;;;;;',
    ].join('\n')
    const result = parseImportCsv(csv)
    expect(result.errors.map((error) => error.row)).toEqual([1, 2, 3, 4])
    expect(result.errors[0].message).toContain('precio')
    expect(result.errors[1].message).toContain('cantidad')
    expect(result.errors[1].message).toContain('ya aparece')
    expect(result.errors[2].message).toContain('notación científica')
  })
  it('avisa cuando faltan columnas', () => {
    const result = parseImportCsv('Producto;Marca\nA;B')
    expect(result.fileErrors[0]).toContain('Faltan columnas obligatorias')
  })
})

describe('columna Socio', () => {
  const header = 'Producto;Categoría;Marca;Corte;Talla;Color;Código de barras;Precio;Costo;Cantidad'
  const row = 'Camisa;Camisas;X;;M;Azul;;650;380;5'

  it('la plantilla sin permiso de socios no trae la columna', () => {
    const table = parseCsv(buildTemplateCsv())
    expect(table[0]).toEqual([...templateHeaders])
    expect(parseImportCsv(buildTemplateCsv()).hasPartnerColumn).toBe(false)
  })
  it('la plantilla con socios agrega «Socio» después de «Cantidad» y se lee sin errores', () => {
    const table = parseCsv(buildTemplateCsv(true))
    expect(table[0]).toEqual([...templateHeadersWithPartner])
    expect(table[0].at(-1)).toBe('Socio')
    expect(table[0].at(-2)).toBe('Cantidad')
    const result = parseImportCsv(buildTemplateCsv(true))
    expect(result.errors).toEqual([])
    expect(result.hasPartnerColumn).toBe(true)
    expect(result.rows.map((item) => item.data?.partner)).toEqual(['Socio Ejemplo', 'Socio Ejemplo', null])
  })
  it('reconoce la cabecera sin importar mayúsculas ni acentos', () => {
    for (const name of ['Socio', 'SOCIO', 'socio', ' Sócio ', 'Partner']) {
      const result = parseImportCsv(`${header};${name}\n${row};Ana López\n`)
      expect(result.errors).toEqual([])
      expect(result.hasPartnerColumn).toBe(true)
      expect(result.rows[0].data?.partner).toBe('Ana López')
    }
  })
  it('una celda vacía de Socio queda en null', () => {
    const result = parseImportCsv(`${header};Socio\n${row};\n`)
    expect(result.rows[0].data?.partner).toBeNull()
  })
  it('sin la columna no agrega `partner` a las filas', () => {
    const result = parseImportCsv(`${header}\n${row}\n`)
    expect(result.hasPartnerColumn).toBe(false)
    expect(result.rows[0].data).not.toHaveProperty('partner')
  })
})

describe('prepareImportRows', () => {
  const csv = 'Producto;Categoría;Marca;Talla;Color;Precio;Costo;Cantidad;Socio\nCamisa;Camisas;X;M;Azul;650;380;5;Ana\nCamisa;Camisas;X;L;Azul;650;380;5;\n'
  const parsed = parseImportCsv(csv)
  it('con permisos manda costo y socio', () => {
    const rows = prepareImportRows(parsed, { canCost: true, canPartners: true })
    expect(rows.map((row) => [row.cost, row.partner])).toEqual([[380, 'Ana'], [380, null]])
  })
  it('sin investment.read ignora el socio', () => {
    const rows = prepareImportRows(parsed, { canCost: true, canPartners: false })
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row).not.toHaveProperty('partner')
  })
  it('sin permiso de costos pone el costo en null pero conserva el socio', () => {
    const rows = prepareImportRows(parsed, { canCost: false, canPartners: true })
    expect(rows.map((row) => [row.cost, row.partner])).toEqual([[null, 'Ana'], [null, null]])
  })
})
