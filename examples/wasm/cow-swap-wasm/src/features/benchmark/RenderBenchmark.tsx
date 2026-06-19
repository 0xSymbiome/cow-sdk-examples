import { useEffect, useState } from 'react'

import { Cow } from '../../ui/Cow'

const LIGHT_KM_PER_MS = 299.792458
const EARTH_CIRCUMFERENCE_KM = 40_075
const EARTH_MOON_KM = 384_400

// The full-render time: navigation start → first paint. `performance.now()` is the
// milliseconds since navigation start, read in a frame after this component mounts.
// Because the app renders only once the WASM module is ready (see main.tsx), this
// captures the honest end-to-end cost — bundle, WASM init, render, and paint.
function useRenderBenchmark(): number | undefined {
  const [renderMs, setRenderMs] = useState<number>()
  useEffect(() => {
    const id = requestAnimationFrame(() => setRenderMs(performance.now()))
    return () => cancelAnimationFrame(id)
  }, [])
  return renderMs
}

// How far light travels in the measured time — exactly c × t.
function lightKm(ms: number): number {
  return Math.round(LIGHT_KM_PER_MS * ms)
}

// A legible, tiered human scale so the distance never reads as a bare number.
function comparison(km: number): string {
  if (km >= EARTH_MOON_KM) return `${(km / EARTH_MOON_KM).toFixed(1)}× the distance to the Moon`
  if (km >= EARTH_CIRCUMFERENCE_KM) return `${(km / EARTH_CIRCUMFERENCE_KM).toFixed(1)}× around the Earth`
  return `${Math.round((km / EARTH_CIRCUMFERENCE_KM) * 100)}% of the way around the Earth`
}

export function RenderBenchmark() {
  const renderMs = useRenderBenchmark()
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (renderMs === undefined) return
    const leave = window.setTimeout(() => setLeaving(true), 5000)
    const remove = window.setTimeout(() => setGone(true), 5900)
    return () => {
      window.clearTimeout(leave)
      window.clearTimeout(remove)
    }
  }, [renderMs])

  if (renderMs === undefined || gone) return null

  const ms = Math.max(0, Math.round(renderMs))
  const km = lightKm(ms)

  return (
    <div className={`benchmark${leaving ? ' benchmark-leaving' : ''}`} role="status">
      <div className="benchmark-bubble">
        <strong>Moo-ving fast ⚡</strong>
        <span>
          Rendered in {ms} ms — light traveled {km.toLocaleString('en-US')} km, {comparison(km)}.
        </span>
      </div>
      <Cow mood="speedy" size={52} blink className="benchmark-cow" />
    </div>
  )
}
