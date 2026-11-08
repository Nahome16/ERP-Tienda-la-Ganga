export type StockCell = {
  color: string
  colorHex: string
  size: string
  stock: number
}

export type DemoProduct = {
  id: string
  barcode: string
  name: string
  category: string
  price: number
  sku: string
  stock: StockCell[]
}

export const demoProducts: DemoProduct[] = [
  {
    id: 'camisa-oxford',
    barcode: '750100000001',
    name: 'Camisa Oxford',
    category: 'Camisas',
    price: 1150,
    sku: 'CAM-OXF',
    stock: [
      { color: 'Blanco', colorHex: '#f7f3e8', size: 'S', stock: 3 },
      { color: 'Blanco', colorHex: '#f7f3e8', size: 'M', stock: 5 },
      { color: 'Blanco', colorHex: '#f7f3e8', size: 'L', stock: 2 },
      { color: 'Celeste', colorHex: '#b9d8e4', size: 'S', stock: 1 },
      { color: 'Celeste', colorHex: '#b9d8e4', size: 'M', stock: 4 },
      { color: 'Celeste', colorHex: '#b9d8e4', size: 'L', stock: 3 },
      { color: 'Negro', colorHex: '#222222', size: 'S', stock: 2 },
      { color: 'Negro', colorHex: '#222222', size: 'M', stock: 6 },
      { color: 'Negro', colorHex: '#222222', size: 'L', stock: 4 },
    ],
  },
  {
    id: 'jeans-recto',
    barcode: '750100000002',
    name: 'Jeans recto',
    category: 'Pantalones',
    price: 1490,
    sku: 'PAN-JRE',
    stock: [
      { color: 'Índigo', colorHex: '#435a7f', size: '30', stock: 4 },
      { color: 'Índigo', colorHex: '#435a7f', size: '32', stock: 8 },
      { color: 'Índigo', colorHex: '#435a7f', size: '34', stock: 5 },
      { color: 'Gris', colorHex: '#9b9b96', size: '30', stock: 1 },
      { color: 'Gris', colorHex: '#9b9b96', size: '32', stock: 3 },
      { color: 'Gris', colorHex: '#9b9b96', size: '34', stock: 0 },
    ],
  },
  {
    id: 'vestido-lino',
    barcode: '750100000003',
    name: 'Vestido lino',
    category: 'Vestidos',
    price: 1890,
    sku: 'VES-LIN',
    stock: [
      { color: 'Terracota', colorHex: '#bd693a', size: 'S', stock: 2 },
      { color: 'Terracota', colorHex: '#bd693a', size: 'M', stock: 4 },
      { color: 'Terracota', colorHex: '#bd693a', size: 'L', stock: 2 },
    ],
  },
  {
    id: 'camiseta-basica',
    barcode: '750100000004',
    name: 'Camiseta básica',
    category: 'Camisetas',
    price: 450,
    sku: 'CAM-BAS',
    stock: [
      { color: 'Negro', colorHex: '#222222', size: 'S', stock: 10 },
      { color: 'Negro', colorHex: '#222222', size: 'M', stock: 14 },
      { color: 'Negro', colorHex: '#222222', size: 'L', stock: 9 },
    ],
  },
  {
    id: 'chaqueta-denim',
    barcode: '750100000005',
    name: 'Chaqueta denim',
    category: 'Chaquetas',
    price: 2350,
    sku: 'CHA-DEN',
    stock: [
      { color: 'Azul', colorHex: '#7699bc', size: 'M', stock: 2 },
      { color: 'Azul', colorHex: '#7699bc', size: 'L', stock: 1 },
    ],
  },
  {
    id: 'falda-plisada',
    barcode: '750100000006',
    name: 'Falda plisada',
    category: 'Faldas',
    price: 990,
    sku: 'FAL-PLI',
    stock: [
      { color: 'Vino', colorHex: '#742231', size: 'S', stock: 2 },
      { color: 'Vino', colorHex: '#742231', size: 'M', stock: 1 },
      { color: 'Vino', colorHex: '#742231', size: 'L', stock: 0 },
    ],
  },
]

export const demoCategories = ['Todo', ...new Set(demoProducts.map((product) => product.category))]

export function formatCordobas(value: number) {
  return new Intl.NumberFormat('es-NI', {
    style: 'currency',
    currency: 'NIO',
    minimumFractionDigits: 2,
  }).format(value)
}
