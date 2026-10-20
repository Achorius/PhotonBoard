// ============================================================
// Legacy command line (before lib/cli): Fixture, Thru, At, Full,
// Zero, Clear, Go, Stop, Group, BO and channel shortcuts ("Gobo 30").
// Kept as the fallback while the command-line engine is not wired
// (no CliContext yet) and for the few shortcuts its grammar does not
// know. Fixture / group numbers = list position (1-based).
// The syntax stays in English in every language (console
// convention); feedback messages are translated (shell.commandLine).
// ============================================================

import type { PatchEntry } from '@shared/types'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { setProgrammerChannel, clearProgrammer } from '@renderer/lib/dmx-mixer'
import { t } from '@renderer/i18n'
import { formatPercent } from '@renderer/components/ui/format'

export interface LegacyResult {
  ok: boolean
  message: string
}

export function executeLegacyCommand(input: string): LegacyResult {
  const raw = input.trim()
  if (!raw) return { ok: false, message: '' }

  const tokens = raw.toLowerCase().split(/\s+/)
  const { patch, groups, selectFixture, clearSelection, getFixtureChannels } = usePatchStore.getState()

  // ---- Clear ----
  if (tokens[0] === 'clear') {
    clearProgrammer()
    return { ok: true, message: t('shell.commandLine.programmerCleared') }
  }

  // ---- Blackout ----
  if (tokens[0] === 'blackout' || tokens[0] === 'bo') {
    useDmxStore.getState().toggleBlackout()
    return { ok: true, message: t('shell.commandLine.blackoutToggled') }
  }

  // ---- Go [cuelist] ----
  if (tokens[0] === 'go') {
    const cuelists = usePlaybackStore.getState().cuelists
    if (tokens[1]) {
      const idx = parseInt(tokens[1]) - 1
      if (idx >= 0 && idx < cuelists.length) {
        usePlaybackStore.getState().goCuelist(cuelists[idx].id)
        return { ok: true, message: t('shell.commandLine.goScene', { n: idx + 1 }) }
      }
      return { ok: false, message: t('shell.commandLine.sceneNotFound', { n: tokens[1] }) }
    }
    if (cuelists.length > 0) {
      usePlaybackStore.getState().goCuelist(cuelists[0].id)
      return { ok: true, message: t('shell.commandLine.goScene', { n: 1 }) }
    }
    return { ok: false, message: t('shell.commandLine.noScenes') }
  }

  // ---- Stop [cuelist] ----
  if (tokens[0] === 'stop') {
    const cuelists = usePlaybackStore.getState().cuelists
    if (tokens[1]) {
      const idx = parseInt(tokens[1]) - 1
      if (idx >= 0 && idx < cuelists.length) {
        usePlaybackStore.getState().stopCuelist(cuelists[idx].id)
        return { ok: true, message: t('shell.commandLine.stopScene', { n: idx + 1 }) }
      }
    }
    // Stop all
    for (const cl of cuelists) {
      if (cl.isPlaying) usePlaybackStore.getState().stopCuelist(cl.id)
    }
    return { ok: true, message: t('shell.commandLine.allStopped') }
  }

  // ---- Group <n> [At <value>] ----
  if (tokens[0] === 'group') {
    const groupIdx = parseInt(tokens[1]) - 1
    if (isNaN(groupIdx) || groupIdx < 0 || groupIdx >= groups.length) {
      return { ok: false, message: t('shell.commandLine.groupNotFound', { n: tokens[1] || '?' }) }
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
      if (value === null) return { ok: false, message: t('shell.commandLine.invalidValue') }
      applyToFixtures(fixtureIds, value, patch, getFixtureChannels)
      return { ok: true, message: t('shell.commandLine.groupAt', { n: groupIdx + 1, name: group.name, percent: formatPercent(value) }) }
    }

    return { ok: true, message: t('shell.commandLine.groupSelected', { name: group.name, count: fixtureIds.length }) }
  }

  // ---- Fixture <range> [At <value>] ----
  if (tokens[0] === 'fixture' || tokens[0] === 'fix' || tokens[0] === 'f') {
    const { ids, endIdx } = parseFixtureRange(tokens, 1, patch)
    if (ids.length === 0) return { ok: false, message: t('shell.commandLine.noMatchingFixtures') }

    // Select fixtures
    clearSelection()
    for (const id of ids) selectFixture(id, true)

    // Check for "At"
    const remaining = tokens.slice(endIdx)
    const atIdx = remaining.indexOf('at')
    if (atIdx > -1) {
      const value = parseValue(remaining[atIdx + 1])
      if (value === null) return { ok: false, message: t('shell.commandLine.invalidValueAfterAt') }
      applyToFixtures(ids, value, patch, getFixtureChannels)
      return { ok: true, message: t('shell.commandLine.fixturesAt', { count: ids.length, percent: formatPercent(value) }) }
    }

    return { ok: true, message: t('shell.commandLine.fixturesSelected', { count: ids.length }) }
  }

  // ---- At <value> (apply to current selection) ----
  if (tokens[0] === 'at' || tokens[0] === '@') {
    const selectedIds = usePatchStore.getState().selectedFixtureIds
    if (selectedIds.length === 0) return { ok: false, message: t('shell.commandLine.noSelection') }
    const value = parseValue(tokens[1])
    if (value === null) return { ok: false, message: t('shell.commandLine.invalidValue') }
    applyToFixtures(selectedIds, value, patch, getFixtureChannels)
    return { ok: true, message: t('shell.commandLine.fixturesAt', { count: selectedIds.length, percent: formatPercent(value) }) }
  }

  // ---- Full (shortcut: selected fixtures at 100%) ----
  if (tokens[0] === 'full') {
    const selectedIds = usePatchStore.getState().selectedFixtureIds
    if (selectedIds.length === 0) return { ok: false, message: t('shell.commandLine.noSelection') }
    applyToFixtures(selectedIds, 255, patch, getFixtureChannels)
    return { ok: true, message: t('shell.commandLine.fixturesFull', { count: selectedIds.length }) }
  }

  // ---- Zero (shortcut: selected fixtures at 0%) ----
  if (tokens[0] === 'zero' || tokens[0] === 'off') {
    const selectedIds = usePatchStore.getState().selectedFixtureIds
    if (selectedIds.length === 0) return { ok: false, message: t('shell.commandLine.noSelection') }
    applyToFixtures(selectedIds, 0, patch, getFixtureChannels)
    return { ok: true, message: t('shell.commandLine.fixturesZero', { count: selectedIds.length }) }
  }

  // ---- Channel <name> <value> — set any channel by name (e.g. Gobo 30, Color 50) ----
  const channelNames = ['gobo', 'color', 'pan', 'tilt', 'zoom', 'focus', 'shutter', 'strobe', 'prism', 'red', 'green', 'blue', 'white', 'amber']
  if (channelNames.includes(tokens[0])) {
    const channelName = tokens[0]
    const selectedIds = usePatchStore.getState().selectedFixtureIds
    // If no selection, apply to all patched fixtures
    const targetIds = selectedIds.length > 0 ? selectedIds : patch.map(p => p.id)
    const rawVal = parseInt(tokens[1])
    if (isNaN(rawVal)) return { ok: false, message: t('shell.commandLine.channelUsage', { channel: channelName }) }
    const dmxVal = Math.min(255, Math.max(0, rawVal))
    const count = applyChannelByName(targetIds, channelName, dmxVal, patch, getFixtureChannels)
    return { ok: true, message: t('shell.commandLine.channelSet', { count, channel: channelName, value: dmxVal }) }
  }

  return { ok: false, message: t('shell.commandLine.unknown', { command: tokens[0] }) }
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

function parseFixtureRange(tokens: string[], startIdx: number, patch: PatchEntry[]): { ids: string[]; endIdx: number } {
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
  patch: PatchEntry[],
  getFixtureChannels: (entry: PatchEntry) => { name: string; absoluteChannel: number; type: string }[]
) {
  for (const id of fixtureIds) {
    const entry = patch.find((p) => p.id === id)
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
  patch: PatchEntry[],
  getFixtureChannels: (entry: PatchEntry) => { name: string; absoluteChannel: number; type: string }[]
): number {
  const target = channelName.toLowerCase()
  let count = 0
  for (const id of fixtureIds) {
    const entry = patch.find((p) => p.id === id)
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
