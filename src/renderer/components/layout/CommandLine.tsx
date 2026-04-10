import React, { useState, useRef, useCallback, useEffect } from 'react'
import { usePatchStore } from '../../stores/patch-store'
import { useDmxStore } from '../../stores/dmx-store'
import { usePlaybackStore } from '../../stores/playback-store'
import { useUiStore } from '../../stores/ui-store'
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

// ---- Component ----

export function CommandLine() {
  const [input, setInput] = useState('')
  const [feedback, setFeedback] = useState<CommandResult | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  // Clear feedback after 3s
  useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => setFeedback(null), 3000)
    return () => clearTimeout(timer)
  }, [feedback])

  const handleSubmit = useCallback(() => {
    if (!input.trim()) return
    const result = executeCommand(input)
    setFeedback(result)
    setHistory(h => [input, ...h.slice(0, 49)])
    setHistoryIdx(-1)
    setInput('')
  }, [input])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const newIdx = Math.min(historyIdx + 1, history.length - 1)
      if (newIdx >= 0 && history[newIdx]) {
        setHistoryIdx(newIdx)
        setInput(history[newIdx])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const newIdx = historyIdx - 1
      if (newIdx < 0) {
        setHistoryIdx(-1)
        setInput('')
      } else {
        setHistoryIdx(newIdx)
        setInput(history[newIdx])
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setInput('')
      inputRef.current?.blur()
    }
  }, [handleSubmit, history, historyIdx])

  return (
    <div className="flex items-center gap-2 min-w-[250px]">
      <span className="text-[10px] text-gray-600 font-mono">&gt;</span>
      <input
        ref={inputRef}
        className="bg-surface-0 border border-surface-3 rounded px-2 py-0.5 text-[11px] font-mono text-gray-300 w-48 focus:border-accent focus:outline-none placeholder:text-gray-700"
        value={input}
        onChange={e => { setInput(e.target.value); setHistoryIdx(-1) }}
        onKeyDown={handleKeyDown}
        placeholder="Fixture 1 Thru 5 At 80"
        spellCheck={false}
      />
      {feedback && (
        <span className={`text-[10px] truncate max-w-[200px] ${feedback.ok ? 'text-green-400' : 'text-red-400'}`}>
          {feedback.message}
        </span>
      )}
    </div>
  )
}
