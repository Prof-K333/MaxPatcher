import { useEffect, useRef } from 'react'

/**
 * Runs `callback` every animation frame, and stops while the tab is hidden —
 * meters have no business burning a core in a background tab.
 */
export function useFrame(callback: () => void) {
  const latest = useRef(callback)
  latest.current = callback

  useEffect(() => {
    let id = 0
    let running = false
    const loop = () => {
      if (!running) return
      latest.current()
      id = requestAnimationFrame(loop)
    }
    const start = () => {
      if (running || document.hidden) return
      running = true
      id = requestAnimationFrame(loop)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(id)
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVisibility)
    start()
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [])
}
