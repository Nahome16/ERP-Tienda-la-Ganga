import { listPartners } from './adminApi'
import { useFetch } from './hooks'

/** Socios para los selectores. Si `enabled` es falso no se pide nada (usuarios sin `investment.read`). */
export function usePartners(status: 'active' | 'all', enabled: boolean) {
  const result = useFetch(`partners|${status}`, (signal) => listPartners(status, signal), enabled)
  return { partners: result.data ?? [], loading: result.loading, error: result.error, reload: result.reload }
}
