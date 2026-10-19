import { useEffect } from 'react'
import { useUiStore } from '@renderer/stores/ui-store'

/**
 * Keeps <html data-density> in sync with the effective density (Settings
 * preference, or 'auto' = touch on coarse pointers / the Pi). Mount once.
 */
export function useDensityController(): void {
  const density = useUiStore((s) => s.density)
  const preference = useUiStore((s) => s.densityPreference)

  useEffect(() => {
    document.documentElement.dataset.density = density
  }, [density])

  useEffect(() => {
    if (preference !== 'auto') return
    let mq: MediaQueryList
    try { mq = window.matchMedia('(pointer: coarse)') } catch { return }
    const refresh = () => useUiStore.getState().refreshDensity()
    mq.addEventListener('change', refresh)
    return () => mq.removeEventListener('change', refresh)
  }, [preference])
}
