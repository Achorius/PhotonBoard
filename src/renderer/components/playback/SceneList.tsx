// ============================================================
// Scene list (master side of the Scenes view).
// Rows: number, executor colour, name, status (cue x/y, fade
// progress), level, executor slot & mode, MIDI badge, quick GO/Stop.
// Keyboard (list focused): ↑ ↓ Home End select, Space = GO (global
// shortcut), Enter selects.
// ============================================================

import { memo, useMemo, useState } from 'react'
import type React from 'react'
import { LuClapperboard, LuPlay, LuPlus, LuSearch, LuSearchX, LuSparkles, LuSquare } from 'react-icons/lu'
import type { Cuelist, MidiMapping } from '@shared/types'
import { Badge, Button, EmptyState, IconButton, TextInput, cn, formatCuePosition, formatPercent } from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { FadeProgress } from './FadeProgress'
import { MODE_LABEL, formatMidiSource, formatSlot, useExecutorSlots, useLearningSceneId, useSceneMidi, type ExecutorSlot } from './scene-meta'
import { createEmptyScene } from './record'

export function SceneList({ selectedId, onRecord }: { selectedId: string | null; onRecord: () => void }) {
  const cuelists = usePlaybackStore((s) => s.cuelists)
  const slots = useExecutorSlots()
  const midi = useSceneMidi()
  const learningId = useLearningSceneId()
  const [query, setQuery] = useState('')

  const numbered = useMemo(() => cuelists.map((cl, i) => ({ cl, n: i + 1 })), [cuelists])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? numbered.filter(({ cl, n }) => cl.name.toLowerCase().includes(q) || String(n) === q) : numbered
  }, [numbered, query])
  const playing = cuelists.reduce((n, c) => n + (c.isPlaying ? 1 : 0), 0)

  const select = (id: string, focus = false) => {
    usePlaybackStore.getState().selectCuelist(id)
    if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-scene-row="${id}"]`)?.focus())
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (shown.length === 0) return
    const idx = shown.findIndex(({ cl }) => cl.id === selectedId)
    let next = -1
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : Math.min(shown.length - 1, idx + 1)
    else if (e.key === 'ArrowUp') next = idx < 0 ? 0 : Math.max(0, idx - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = shown.length - 1
    else return
    e.preventDefault()
    e.stopPropagation()
    select(shown[next].cl.id, true)
  }

  return (
    <section aria-label="Scenes" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-control-lg shrink-0 items-center gap-2 pl-3 pr-1.5">
        <h2 className="text-sm font-semibold text-fg-primary">Scenes</h2>
        <span className="text-xs tabular text-fg-tertiary">{cuelists.length}</span>
        {playing > 0 && <Badge tone="go" size="xs">{playing} LIVE</Badge>}
        <div className="flex-1" />
        <IconButton icon={LuPlus} label="New empty scene" size="sm" onClick={() => createEmptyScene()} />
      </header>
      {cuelists.length > 6 && (
        <div className="shrink-0 border-b border-line-subtle px-2.5 pb-2.5">
          <TextInput
            size="sm"
            icon={LuSearch}
            placeholder="Find scene by name or number"
            aria-label="Find scene"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery('')}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQuery(''); e.currentTarget.blur() } }}
          />
        </div>
      )}
      <div
        role="listbox"
        aria-label="Scenes"
        onKeyDown={onKeyDown}
        className={cn('min-h-0 flex-1 overflow-y-auto p-1.5', cuelists.length <= 6 && 'border-t border-line-subtle')}
      >
        {cuelists.length === 0 ? (
          <EmptyState
            size="sm"
            icon={LuClapperboard}
            title="No scenes yet"
            description="Set a look in Fixtures, then record it. Scenes play from here, the executor bar and MIDI."
            action={<>
              <Button variant="primary" size="sm" onClick={onRecord}>Record scene</Button>
              <Button variant="ghost" size="sm" icon={LuPlus} onClick={() => createEmptyScene()}>Empty scene</Button>
            </>}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            size="sm"
            icon={LuSearchX}
            title="No matching scene"
            description={`Nothing is named “${query}”.`}
            action={<Button variant="ghost" size="sm" onClick={() => setQuery('')}>Clear search</Button>}
          />
        ) : (
          <div className="flex flex-col gap-1">
            {shown.map(({ cl, n }) => (
              <SceneRow
                key={cl.id}
                cuelist={cl}
                number={n}
                selected={cl.id === selectedId}
                slot={slots.get(cl.id)}
                midi={midi.get(cl.id)}
                learning={learningId === cl.id}
                onSelect={select}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

const SceneRow = memo(function SceneRow({ cuelist: cl, number, selected, slot, midi, learning, onSelect }: {
  cuelist: Cuelist
  number: number
  selected: boolean
  slot: ExecutorSlot | undefined
  midi: MidiMapping | undefined
  learning: boolean
  onSelect: (id: string) => void
}) {
  const playing = cl.isPlaying
  const cue = playing ? cl.cues[cl.currentCueIndex] : undefined
  const fx = cl.effectSnapshots?.length ?? 0
  const color = slot?.color
  const level = cl.flash ? 255 : cl.faderLevel

  return (
    <div
      role="option"
      aria-selected={selected}
      data-scene-row={cl.id}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(cl.id)}
      onFocus={() => { if (!selected) onSelect(cl.id) }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSelect(cl.id) } }}
      className={cn(
        'group relative flex min-h-[52px] cursor-pointer select-none items-center gap-2.5 overflow-hidden rounded-md border pl-3 pr-1.5 outline-offset-[-2px] transition-colors duration-fast',
        '[[data-density=touch]_&]:min-h-[64px]',
        selected ? 'border-info/60 bg-info/15' : cn('bg-surface-2 hover:bg-surface-3', playing ? 'border-go/40' : 'border-transparent')
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: color ?? 'rgb(var(--pb-line-strong))', opacity: playing ? 1 : 0.6 }} />
      <span
        className={cn(
          'flex h-7 min-w-7 shrink-0 items-center justify-center rounded px-1 font-mono text-xs font-semibold tabular',
          '[[data-density=touch]_&]:h-9 [[data-density=touch]_&]:min-w-9',
          playing ? 'bg-go text-on-go' : 'bg-surface-4 text-fg-secondary'
        )}
      >
        {number}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-fg-primary">{cl.name || 'Untitled'}</span>
          {fx > 0 && <LuSparkles size={12} aria-label={`${fx} effects`} className="shrink-0 text-fg-tertiary" />}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs">
          {playing ? (
            <>
              <span className="shrink-0 font-mono tabular text-go-fg">{formatCuePosition(cl.currentCueIndex, cl.cues.length)}</span>
              <span className="truncate text-fg-secondary">{cue?.name}</span>
              {cl.flash && <Badge tone="warning" size="xs">FLASH</Badge>}
            </>
          ) : (
            <span className="truncate text-fg-tertiary">{cl.cues.length === 0 ? 'No cues' : `${cl.cues.length} cue${cl.cues.length === 1 ? '' : 's'}`}{cl.isLooping ? ' · loop' : ''}</span>
          )}
          {level < 255 && <span className="shrink-0 font-mono tabular text-fg-tertiary">{formatPercent(level)}</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="flex items-center gap-1">
          {learning ? (
            <Badge tone="midi" variant="solid" size="xs" className="animate-pulse">LEARN</Badge>
          ) : midi ? (
            <Badge tone="midi" size="xs" mono title={`MIDI ${formatMidiSource(midi)}`}>{formatMidiSource(midi)}</Badge>
          ) : null}
          {slot && slot.mode !== 'toggle' && <Badge tone={slot.mode === 'flash' ? 'warning' : 'info'} size="xs">{MODE_LABEL[slot.mode]}</Badge>}
        </span>
        {slot && <span className="font-mono text-2xs tabular text-fg-tertiary" title={`Executor column ${slot.col + 1}, row ${slot.row + 1}`}>EX {formatSlot(slot)}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {playing && (
          <IconButton icon={LuSquare} label={`Stop ${cl.name}`} size="sm" onClick={() => usePlaybackStore.getState().stopCuelist(cl.id)} />
        )}
        <IconButton
          icon={LuPlay}
          label={`GO ${cl.name}`}
          size="sm"
          variant="secondary"
          disabled={cl.cues.length === 0}
          className="!text-go-fg"
          onClick={() => usePlaybackStore.getState().goCuelist(cl.id)}
        />
      </span>
      <FadeProgress cuelist={cl} className="absolute inset-x-0 bottom-0" />
    </div>
  )
})
