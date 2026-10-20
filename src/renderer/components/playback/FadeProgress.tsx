// ============================================================
// Fade progress without per-frame React renders.
// A module-level subscription notes when each scene's GO happened
// (cue index + goGeneration change); <FadeProgress> then mounts a
// CSS-animated bar whose negative delay skips the time already
// elapsed — so remounting (tab switch, list filter) keeps the real
// position, and nothing re-renders while the fade runs.
// ============================================================

import { useState } from 'react'
import { cn } from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import type { Cuelist } from '@shared/types'

const goTimes = new Map<string, { key: string; at: number }>()

function goKey(cl: Cuelist): string {
  return `${cl.currentCueIndex}:${cl.goGeneration ?? 0}`
}

// Scenes already playing when the app starts are treated as settled
for (const cl of usePlaybackStore.getState().cuelists) {
  if (cl.isPlaying) goTimes.set(cl.id, { key: goKey(cl), at: -Infinity })
}

usePlaybackStore.subscribe((s, p) => {
  if (s.cuelists === p.cuelists) return
  const now = performance.now()
  for (const cl of s.cuelists) {
    if (!cl.isPlaying) {
      goTimes.delete(cl.id)
      continue
    }
    const key = goKey(cl)
    if (goTimes.get(cl.id)?.key !== key) goTimes.set(cl.id, { key, at: now })
  }
})

/** Delay and fade (the longer of fade in / out) of a cue, seconds */
export function cueFadeSeconds(cue: { fadeIn: number; fadeOut: number; delay: number } | undefined): { delay: number; fade: number } {
  if (!cue) return { delay: 0, fade: 0 }
  return { delay: Math.max(0, cue.delay || 0), fade: Math.max(0, cue.fadeIn || 0, cue.fadeOut || 0) }
}

export interface FadeProgressProps {
  cuelist: Cuelist
  className?: string
  /** Bar colour class (default go) */
  barClassName?: string
}

/** Thin bar that fills during the running cue's fade (the delay shows an empty track). */
export function FadeProgress({ cuelist: cl, className, barClassName = 'bg-go-fg' }: FadeProgressProps) {
  if (!cl.isPlaying || cl.flash) return null
  const { delay, fade } = cueFadeSeconds(cl.cues[cl.currentCueIndex])
  if (delay + fade <= 0) return null
  const key = goKey(cl)
  return <FadeBar key={key} id={cl.id} goKey={key} delay={delay} fade={fade} className={className} barClassName={barClassName} />
}

/** Mounted once per GO: the animation timing is frozen at mount (re-renders never shift it) */
function FadeBar({ id, goKey: key, delay, fade, className, barClassName }: {
  id: string
  goKey: string
  delay: number
  fade: number
  className?: string
  barClassName: string
}) {
  const [animation] = useState(() => {
    const rec = goTimes.get(id)
    const elapsed = rec && rec.key === key ? (performance.now() - rec.at) / 1000 : 0
    const total = delay + fade
    if (elapsed >= total + 0.4) return null
    return fade > 0
      ? `pb-progress ${fade}s linear ${delay - elapsed}s both, pb-fade-out 400ms ease ${total - elapsed}s forwards`
      : `pb-fade-out 400ms ease ${total - elapsed}s forwards`
  })
  if (!animation) return null
  return (
    <span aria-hidden className={cn('pointer-events-none block h-0.5 overflow-hidden', className)}>
      <span
        className={cn('block h-full w-full origin-left', barClassName)}
        style={{ animation, transform: fade > 0 ? undefined : 'scaleX(0)' }}
      />
    </span>
  )
}
