import { useEffect, useRef } from 'react'

/** Calls cb(dtSeconds) every animation frame while `active`. */
export function useFrame(active: boolean, cb: (dt: number) => void) {
  const ref = useRef(cb)
  useEffect(() => {
    ref.current = cb
  })
  useEffect(() => {
    if (!active) return
    let id = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      ref.current(dt)
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [active])
}

export const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const toPath = (pts: readonly (readonly [number, number])[], close = false, flip = true): string => {
  let d = ''
  for (let i = 0; i < pts.length; i++) d += `${i ? 'L' : 'M'}${+pts[i][0].toFixed(3)} ${+(flip ? -pts[i][1] : pts[i][1]).toFixed(3)}`
  return d + (close ? 'Z' : '')
}
