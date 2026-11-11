import type { KeyboardEvent } from 'react'

/**
 * Los escáneres USB escriben el código y presionan Enter. Dentro de un
 * formulario eso lo enviaría a medias: Enter en un campo de texto no envía.
 */
export function blockEnterSubmit(event: KeyboardEvent<HTMLFormElement>) {
  const target = event.target as HTMLElement
  if (event.key === 'Enter' && target instanceof HTMLInputElement && target.type !== 'submit' && target.type !== 'button') {
    event.preventDefault()
  }
}
