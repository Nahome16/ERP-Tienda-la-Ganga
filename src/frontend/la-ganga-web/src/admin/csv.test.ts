import { describe, expect, it } from 'vitest'
import { buildTemplateCsv, detectDelimiter, parseCsv, parseDecimal, parseImportCsv, templateHeaders } from './csv'

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
