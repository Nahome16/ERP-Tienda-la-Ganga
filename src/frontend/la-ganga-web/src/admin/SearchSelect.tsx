import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { exactOption, filterOptions, type SearchOption } from './searchOptions'

/**
 * Lista desplegable con búsqueda: se escribe parte del nombre (o unas letras) y la lista
 * se filtra. Flechas ↑ ↓ para moverse, Enter para elegir, Esc para cerrar.
 */
export function SearchSelect({ label, value, options, onChange, placeholder, required = false, emptyLabel }: {
  /** Nombre accesible de la casilla («Marca»). */
  label: string
  value: string
  options: SearchOption[]
  onChange: (id: string) => void
  placeholder?: string
  required?: boolean
  /** Opción para dejarlo vacío («Sin corte»). Si no se da, no se puede vaciar desde la lista. */
  emptyLabel?: string
}) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = options.find((option) => option.id === value)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  const text = query ?? selected?.label ?? ''
  const matches = query === null ? options : filterOptions(options, query)
  const items: SearchOption[] = emptyLabel && (query === null || query.trim() === '') ? [{ id: '', label: emptyLabel }, ...matches] : matches
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0))

  function choose(option: SearchOption) {
    onChange(option.id)
    setQuery(null)
    setOpen(false)
  }

  function close() {
    // Si lo escrito es exactamente una opción, se queda elegida; si no, vuelve lo que había.
    if (query !== null) {
      const exact = exactOption(options, query)
      if (exact) onChange(exact.id)
      else if (query.trim() === '' && emptyLabel) onChange('')
    }
    setQuery(null)
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) {
        if (!event.altKey) return // cerrada: las flechas cambian de casilla
        event.preventDefault()
        setOpen(true)
        return
      }
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((activeIndex + step + items.length) % Math.max(items.length, 1))
    } else if (event.key === 'Enter') {
      if (!open) return
      event.preventDefault()
      const option = items[activeIndex]
      if (option) choose(option)
    } else if (event.key === 'Escape') {
      if (!open) return
      // No cierra la ventana: solo la lista.
      event.preventDefault()
      event.stopPropagation()
      setQuery(null)
      setOpen(false)
    } else if (event.key === 'Tab' && open) {
      const option = query !== null && query.trim() !== '' ? items[activeIndex] : undefined
      if (option) onChange(option.id)
      setQuery(null)
      setOpen(false)
    }
  }

  return (
    <div className="search-select">
      <input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={text}
        placeholder={placeholder ?? (emptyLabel || 'Escribí para buscar')}
        required={required}
        onFocus={(event) => { event.currentTarget.select(); setActive(0) }}
        onClick={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true) }}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
      <button
        type="button" className="search-select-toggle" tabIndex={-1} aria-label={`Ver todas: ${label}`}
        onMouseDown={(event) => { event.preventDefault(); if (open) close(); else { setQuery(null); setOpen(true); inputRef.current?.focus() } }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <ul id={listId} role="listbox" aria-label={label} className="search-select-list">
          {items.length === 0 && <li className="search-select-empty">No hay {label.toLowerCase()} con «{query}».</li>}
          {items.map((option, index) => (
            <li
              key={option.id || 'empty'}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.id === value}
              className={`${index === activeIndex ? 'is-active' : ''}${option.id === '' ? ' is-empty' : ''}`}
              onMouseDown={(event) => { event.preventDefault(); choose(option) }}
              onMouseEnter={() => setActive(index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
