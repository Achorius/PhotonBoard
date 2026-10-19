import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { LuChevronRight } from 'react-icons/lu'
import { cn } from '@renderer/components/ui'
import { COMMAND_LINE_ID } from '@renderer/hooks/useKeyboardShortcuts'
import { usePatchStore } from '../../stores/patch-store'
import { useDmxStore } from '../../stores/dmx-store'
import { usePlaybackStore } from '../../stores/playback-store'
import { setProgrammerChannel, clearProgrammer } from '../../lib/dmx-mixer'

// ============================================================
// CommandLine — GrandMA3-style command input
// Supports: Fixture, Thru, At, Full, Zero, Clear, Go, Stop, Group
// ============================================================

interface CommandResult {
  ok: boolean
  message: string
}

function executeCommand(input: string): CommandResult {
  const raw = input.trim()
  if (!raw) return { ok: false, message: '' }

  const tokens = raw.toLowerCase().split(/\s+/)
  const { patch, groups, selectFixture, clearSelection, getFixtureChannels } = usePatchStore.getState()

  // ---- Clear ----
  if (tokens[0] === 'clear') {
    clearProgrammer()
    return { ok: true, message: 'Programmer cleared' }
  }

  // ---- Blackout ----
  if (tokens[0] === 'blackout' || tokens[0] === 'bo') {
    useDmxStore.getState().toggleBlackout()
    return { ok: true, message: 'Blackout toggled' }
  }

  // ---- Go [cuelist] ----
  if (tokens[0] === 'go') {
    const cuelists = usePlaybackStore.getState().cuelists
    if (tokens[1]) {
      const idx = parseInt(tokens[1]) - 1
      if (idx >= 0 && idx < cuelists.length) {
        usePlaybackStore.getState().goCuelist(cuelists[idx].id)
        return { ok: true, message: `GO Scene ${idx + 1}` }
      }
      return { ok: false, message: `Scene ${tokens[1]} not found` }
    }
    if (cuelists.length > 0) {
      usePlaybackStore.getState().goCuelist(cuelists[0].id)
      return { ok: true, message: 'GO Scene 1' }
    }
    return { ok: false, message: 'No scenes' }
  }

  // ---- Stop [cuelist] ----
  if (tokens[0] === 'stop') {
    const cuelists = usePlaybackStore.getState().cuelists
    if (tokens[1]) {
      const idx = parseInt(tokens[1]) - 1
      if (idx >= 0 && idx < cuelists.length) {
        usePlaybackStore.getState().stopCuelist(cuelists[idx].id)
        return { ok: true, message: `STOP Scene ${idx + 1}` }
      }
    }
    // Stop all
    for (const cl of cuelists) {
      if (cl.isPlaying) usePlaybackStore.getState().stopCuelist(cl.id)
    }
    return { ok: true, message: 'All scenes stopped' }
  }

  // ---- Group <n> [At <value>] ----
  if (tokens[0] === 'group') {
    const groupIdx = parseInt(tokens[1]) - 1
    if (isNaN(groupIdx) || groupIdx < 0 || groupIdx >= groups.length) {
      return { ok: false, message: `Group ${tokens[1] || '?'} not found` }
    }
    const group = groups[groupIdx]
    const fixtureIds = group.fixtureIds.filter(id => patch.some(p => p.id === id))

    // Select the group
    clearSelection()
    for (const id of fixtureIds) selectFixture(id, true)

    // If "At" follows, apply value
    const atIdx = tokens.indexOf('at')
    if (atIdx > -1) {
      const value = parseValue(tokens[atIdx + 1])
      if (value === null) return { ok: false, message: 'Invalid value' }
      applyToFixtures(fixtureIds, value, patch, getFixtureChannels)
      return { ok: true, message: `Group ${groupIdx + 1} "${group.name}" at ${Math.round(value / 255 * 100)}%` }
    }

    return { ok: true, message: `Selected group "${group.name}" (${fixtureIds.length} fixtures)` }
  }

  // ---- Fixture <range> [At <value>] ----
  if (tokens[0] === 'fixture' || tokens[0] === 'fix' || tokens[0] === 'f') {
    const { ids, endIdx } = parseFixtureRange(tokens, 1, patch)
    if (ids.length === 0) return { ok: false, message: 'No matching fixtures' }

    // Select fixtures
    clearSelection()
    for (const id of ids) selectFixture(id, true)

    // Check for "At"
    const remaining = tokens.slice(endIdx)
    const atIdx = remaining.indexOf('at')
    if (atIdx > -1) {
      const value = parseValue(remaining[atIdx + 1])
      if (value === null) return { ok: false, message: 'Invalid value after At' }
      applyToFixtures(ids, value, patch, getFixtureChannels)
      return { ok: true, message: `${ids.length} fixture(s) at ${Math.round(value / 255 * 100)}%` }
    }

    return { ok: true, message: `Selected ${ids.length} fixture(s)` }
  }

  // ---- At <value> (apply to current selection) ----
  if (tokens[0] === 'at' || tokens[0] === '@') {
    const selectedIds = usePatchStore.getState().selectedFixtureIds
    if (selectedIds.length === 0) return { ok: false, message: 'No fixtures selected' }
    const value = parseValue(tokens[1])
    if (value === null) return { ok: false, message: 'Invalid value' }
    applyToFixtures(selectedIds, value, patch, getFixtureChannels)
    return { ok: true, message: `${selectedIds.length} fixture(s) at ${Math.round(value / 255 * 100)}%` }
  }

  // ---- Full (shortcut: selected fixtures at 100%) ----
  if (tokens[0] === 'full') {
    const selectedIds = usePatchStore.getState().selectedFixtureIds
    if (selectedIds.length === 0) return { ok: false, message: 'No fixtures selected' }
    applyToFixtures(selectedIds, 255, patch, getFixtureChannels)
    return { ok: true, message: `${selectedIds.length} fixture(s) at Full` }
  }

  // ---- Zero (shortcut: selected fixtures at 0%) ----
  if (tokens[0] === 'zero' || tokens[0] === 'off') {
    const selectedIds = usePatchStore.getState().selectedFixtureIds
    if (selectedIds.length === 0) return { ok: false, message: 'No fixtures selected' }
    applyToFixtures(selectedIds, 0, patch, getFixtureChannels)
    return { ok: true, message: `${selectedIds.length} fixture(s) at Zero` }
  }

  // ---- Channel <name> <value> — set any channel by name (e.g. Gobo 30, Color 50) ----
  const channelNames = ['gobo', 'color', 'pan', 'tilt', 'zoom', 'focus', 'shutter', 'strobe', 'prism', 'red', 'green', 'blue', 'white', 'amber']
  if (channelNames.includes(tokens[0])) {
    const channelName = tokens[0]
    const selectedIds = usePatchStore.getState().selectedFixtureIds
    // If no selection, apply to all patched fixtures
    const targetIds = selectedIds.length > 0 ? selectedIds : patch.map(p => p.id)
    const rawVal = parseInt(tokens[1])
    if (isNaN(rawVal)) return { ok: false, message: `${channelName} <0-255>` }
    const dmxVal = Math.min(255, Math.max(0, rawVal))
    const count = applyChannelByName(targetIds, channelName, dmxVal, patch, getFixtureChannels)
    return { ok: true, message: `${count} fixture(s) ${channelName} = ${dmxVal}` }
  }

  return { ok: false, message: `Unknown command: ${tokens[0]}` }
}

// ---- Helpers ----

function parseValue(token: string | undefined): number | null {
  if (!token) return null
  if (token === 'full') return 255
  if (token === 'zero' || token === 'off') return 0
  const num = parseFloat(token)
  if (isNaN(num)) return null
  // If <= 100, treat as percentage; otherwise as DMX 0-255
  if (num <= 100) return Math.round((num / 100) * 255)
  return Math.min(255, Math.round(num))
}

function parseFixtureRange(tokens: string[], startIdx: number, patch: any[]): { ids: string[]; endIdx: number } {
  const ids: string[] = []
  let i = startIdx

  // Parse first number
  const first = parseInt(tokens[i])
  if (isNaN(first)) return { ids: [], endIdx: i }
  i++

  // Check for "thru" / ">"
  if (tokens[i] === 'thru' || tokens[i] === '>') {
    i++
    const last = parseInt(tokens[i])
    if (isNaN(last)) return { ids: [], endIdx: i }
    i++

    // Match by patch index (1-based)
    for (let n = first; n <= last; n++) {
      if (n - 1 >= 0 && n - 1 < patch.length) {
        ids.push(patch[n - 1].id)
      }
    }
  } else if (tokens[i] === '+') {
    // Additive: Fixture 1 + 3 + 5
    if (first - 1 >= 0 && first - 1 < patch.length) ids.push(patch[first - 1].id)
    while (tokens[i] === '+') {
      i++
      const n = parseInt(tokens[i])
      if (!isNaN(n) && n - 1 >= 0 && n - 1 < patch.length) {
        ids.push(patch[n - 1].id)
      }
      i++
    }
  } else {
    // Single fixture
    if (first - 1 >= 0 && first - 1 < patch.length) {
      ids.push(patch[first - 1].id)
    }
  }

  return { ids, endIdx: i }
}

function applyToFixtures(
  fixtureIds: string[],
  value: number,
  patch: any[],
  getFixtureChannels: (entry: any) => { name: string; absoluteChannel: number; type: string }[]
) {
  for (const id of fixtureIds) {
    const entry = patch.find((p: any) => p.id === id)
    if (!entry) continue
    const channels = getFixtureChannels(entry)
    // Apply to dimmer/intensity channel
    const dimmer = channels.find(c =>
      c.name.toLowerCase() === 'dimmer' || c.name.toLowerCase() === 'intensity'
    )
    if (dimmer) {
      setProgrammerChannel(entry.universe, dimmer.absoluteChannel, value)
    }
  }
}

function applyChannelByName(
  fixtureIds: string[],
  channelName: string,
  value: number,
  patch: any[],
  getFixtureChannels: (entry: any) => { name: string; absoluteChannel: number; type: string }[]
): number {
  const target = channelName.toLowerCase()
  let count = 0
  for (const id of fixtureIds) {
    const entry = patch.find((p: any) => p.id === id)
    if (!entry) continue
    const channels = getFixtureChannels(entry)
    // Match by name containing the target (e.g. "gobo" matches "Gobo", "Gobo Wheel")
    const ch = channels.find(c => c.name.toLowerCase().includes(target))
    if (ch) {
      setProgrammerChannel(entry.universe, ch.absoluteChannel, value)
      count++
    }
  }
  return count
}

// ---- Component ----

const HISTORY_MAX = 50
/** Kept across remounts (executor bar / status bar re-layout) */
const history: string[] = []

export function CommandLine() {
  const [input, setInput] = useState('')
  const [feedback, setFeedback] = useState<CommandResult | null>(null)
  const historyIdx = useRef(-1)
  const draft = useRef('')

  // Feedback fades after a few seconds
  useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => setFeedback(null), feedback.ok ? 3000 : 5000)
    return () => clearTimeout(timer)
  }, [feedback])

  const submit = () => {
    const cmd = input.trim()
    if (!cmd) return
    setFeedback(executeCommand(cmd))
    if (history[0] !== cmd) history.unshift(cmd)
    history.length = Math.min(history.length, HISTORY_MAX)
    historyIdx.current = -1
    setInput('')
  }

  const recall = (dir: 1 | -1) => {
    const next = historyIdx.current + dir
    if (next < -1 || next >= history.length) return
    if (historyIdx.current === -1) draft.current = input
    historyIdx.current = next
    setInput(next === -1 ? draft.current : history[next])
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); submit() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); recall(1) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); recall(-1) }
    else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setInput('')
      historyIdx.current = -1
      e.currentTarget.blur()
    }
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <label
        className={cn(
          'flex h-control-xs w-full max-w-[420px] min-w-[200px] items-center gap-1 rounded-sm border bg-surface-0 pl-1.5 pr-2 font-mono text-xs transition-colors duration-fast',
          'border-line focus-within:border-accent/70 focus-within:ring-1 focus-within:ring-accent/30'
        )}
      >
        <LuChevronRight size={14} aria-hidden className="shrink-0 text-accent-fg" />
        <input
          id={COMMAND_LINE_ID}
          className="h-full min-w-0 flex-1 bg-transparent text-fg-primary outline-none placeholder:text-fg-disabled"
          value={input}
          onChange={(e) => { setInput(e.target.value); historyIdx.current = -1 }}
          onKeyDown={onKeyDown}
          placeholder="Fixture 1 thru 4 at 80   (press /)"
          spellCheck={false}
          autoComplete="off"
          aria-label="Command line"
        />
      </label>
      {feedback && (
        <span role="status" className={cn('min-w-0 truncate text-xs', feedback.ok ? 'text-go-fg' : 'text-danger-fg')}>
          {feedback.message}
        </span>
      )}
    </div>
  )
}
