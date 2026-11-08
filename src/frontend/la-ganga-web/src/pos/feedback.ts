// Sonido y vibración opcionales para el escáner. La preferencia es solo una
// comodidad de este equipo, por eso va en localStorage (no es dato de negocio).

const KEY = 'la-ganga-pos-sound'

export function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function saveSoundPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(KEY, enabled ? 'on' : 'off')
  } catch {
    // sin almacenamiento: la preferencia dura hasta recargar
  }
}

let audio: AudioContext | null = null

function beep(frequency: number, durationMs: number, offsetMs = 0) {
  try {
    const Context = window.AudioContext
    audio ??= new Context()
    const context = audio
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'square'
    oscillator.frequency.value = frequency
    gain.gain.value = 0.06
    oscillator.connect(gain)
    gain.connect(context.destination)
    const start = context.currentTime + offsetMs / 1000
    oscillator.start(start)
    oscillator.stop(start + durationMs / 1000)
  } catch {
    // el navegador puede bloquear el audio hasta que haya interacción
  }
}

export function signal(kind: 'ok' | 'error', enabled: boolean) {
  if (!enabled) return
  if (kind === 'ok') {
    beep(1200, 70)
  } else {
    beep(220, 160)
    beep(180, 220, 190)
    try { navigator.vibrate?.([120, 60, 120]) } catch { /* sin vibración */ }
  }
}
