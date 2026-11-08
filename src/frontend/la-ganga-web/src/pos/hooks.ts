import { useEffect, useState, useSyncExternalStore } from 'react'
import { PosEngine, type EngineState } from './engine'

export function usePosEngine(userId: string): { engine: PosEngine; state: EngineState } {
  const [engine] = useState(() => new PosEngine(userId))
  useEffect(() => {
    void engine.start()
    return () => engine.stop()
  }, [engine])
  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  return { engine, state }
}

/** Reloj que se actualiza solo (para «hace 3 min»). */
export function useNow(intervalMs = 20_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
