/** Opción de una lista con búsqueda (marca, categoría, corte…). */
export type SearchOption = { id: string; label: string }

/** Minúsculas y sin tildes: «Categoría» y «categoria» son lo mismo. */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

/**
 * Filtra por nombre o por letras. Primero lo que empieza con lo escrito, después lo
 * que tiene una palabra que empieza así y al final lo que lo contiene en cualquier parte.
 * Con varias palabras, cada una tiene que aparecer («cab cam» → «Caballero › Camisas»).
 */
export function filterOptions(options: SearchOption[], query: string): SearchOption[] {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return options
  const scored: { option: SearchOption; rank: number; index: number }[] = []
  options.forEach((option, index) => {
    const text = normalizeText(option.label)
    if (!words.every((word) => text.includes(word))) return
    const first = words[0] ?? ''
    const rank = text.startsWith(first) ? 0 : text.split(/[\s›/·-]+/).some((part) => part.startsWith(first)) ? 1 : 2
    scored.push({ option, rank, index })
  })
  return scored.sort((a, b) => a.rank - b.rank || a.index - b.index).map((item) => item.option)
}

/** La opción cuyo nombre es exactamente lo escrito (sin importar tildes ni mayúsculas). */
export function exactOption(options: SearchOption[], query: string): SearchOption | undefined {
  const target = normalizeText(query)
  return target ? options.find((option) => normalizeText(option.label) === target) : undefined
}
