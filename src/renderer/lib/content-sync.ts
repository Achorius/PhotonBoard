// ============================================================
// PhotonBoard — Show content sync between the console and remotes
//
// The console renderer runs the show (single source of truth). A remote
// browser (Mac, tablet) holds a copy it can EDIT:
//
//   remote: every content edit (scenes, cues, chases, patch, groups,
//     effects, MIDI mappings, executor layout, timeline…) is diffed per
//     SECTION against what the console last sent, debounced (~150 ms)
//     and sent as 'apply-show-content' { origin, seq, sections }.
//     Runtime state (playing, faders, running effects…) is not content:
//     it has its own commands and comes back with the state broadcasts.
//
//   console: merges the sections into its stores WITHOUT stopping
//     anything (items that stay keep their runtime state, removed ones
//     release their output), marks the show dirty and bumps a revision
//     per section. The state snapshot publishes { epoch, sections }.
//
//   remote: a revision it did not produce → fetch those sections of the
//     console's CURRENT show (show:get-current) and apply them under a
//     guard (never echoed back).
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import type { Chase, Cuelist, Effect } from '@shared/types'
import {
  CONTENT_SECTIONS, isContentSection, isListSection, normalizeSectionItems, normalizeSectionValue,
  type ContentItems, type ContentSection, type ContentValues, type ExecutorRefIds, type ListSection, type TimelineContent
} from '@shared/show-format'
import type {
  ApplyShowContentPayload, ContentRevision, ContentState, CurrentShowContent, SectionChange
} from '@shared/remote-commands'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore, forgetFlashStarted } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { getExecutorContent, useExecutorStore } from '@renderer/stores/executor-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import {
  applyListChange, diffSection, reconcilePatchGroups, replaceList, replaceValue, sameSection, type SectionData
} from './content-merge'
import {
  getTimelineState, onTimelineSettingsChange, setTimelineLooping, setTimelineTotalDuration
} from './timeline-engine'
import { startEffect, stopEffect } from './effect-engine'
import { applyShowData, collectShowData, onShowApplied, withoutDirtyTracking, type ShowIoResult } from './show-io'
import { t } from '@renderer/i18n'
import { getBridge, isRemoteMode, sendRemoteCommand, setRemoteCommandPreflight } from './runtime'

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ---------------------------------------------------------------
// Reading / writing sections of the stores
// ---------------------------------------------------------------

export function readSection<S extends ContentSection>(section: S): SectionData[S] {
  const pb = usePlaybackStore.getState()
  switch (section) {
    case 'patch': return usePatchStore.getState().patch as SectionData[S]
    case 'groups': return usePatchStore.getState().groups as SectionData[S]
    case 'presets': return pb.presets as SectionData[S]
    case 'cuelists': return pb.cuelists as SectionData[S]
    case 'chases': return pb.chases as SectionData[S]
    case 'effects': return useEffectsStore.getState().effects as SectionData[S]
    case 'midiMappings': return useMidiStore.getState().mappings as SectionData[S]
    case 'executor': return getExecutorContent(useExecutorStore.getState().pages) as SectionData[S]
    case 'macros': return usePoolStore.getState().macros as SectionData[S]
    case 'speedMasters': return usePoolStore.getState().speedMasters as SectionData[S]
    case 'stagePages': return usePoolStore.getState().stagePages as SectionData[S]
    case 'parked': return usePoolStore.getState().parked as SectionData[S]
    case 'timeline': {
      const { totalDuration, isLooping } = getTimelineState()
      const timeline: TimelineContent = {
        clips: pb.timelineClips,
        markers: pb.timelineMarkers,
        zones: pb.timelineZones,
        trackCount: pb.timelineTrackCount,
        trackNames: pb.timelineTrackNames,
        length: totalDuration,
        loop: isLooping
      }
      return timeline as SectionData[S]
    }
    default: return useVisualizerStore.getState().roomConfig as SectionData[S]
  }
}

export function readAllSections(): SectionData {
  const out = {} as Record<ContentSection, unknown>
  for (const s of CONTENT_SECTIONS) out[s] = readSection(s)
  return out as SectionData
}

/**
 * Write a section into the stores. On the console, the engines follow:
 * running effects whose definition changed are updated in place (phase
 * kept), removed ones stop; removed scenes / chases are released by the
 * playback controller when they disappear from the store.
 */
function commitSection<S extends ContentSection>(section: S, next: SectionData[S]): void {
  const prev = readSection(section)
  if (prev === next) return
  const onConsole = !isRemoteMode()
  switch (section) {
    case 'patch': {
      const patch = next as SectionData['patch']
      const ids = new Set(patch.map(p => p.id))
      const sel = usePatchStore.getState().selectedFixtureIds
      const selected = sel.every(id => ids.has(id)) ? sel : sel.filter(id => ids.has(id))
      usePatchStore.setState({ patch, selectedFixtureIds: selected })
      break
    }
    case 'groups':
      usePatchStore.setState({ groups: next as SectionData['groups'] })
      break
    case 'presets':
      usePlaybackStore.setState({ presets: next as SectionData['presets'] })
      break
    case 'cuelists': {
      const cuelists = next as Cuelist[]
      const ids = new Set(cuelists.map(c => c.id))
      for (const c of prev as Cuelist[]) if (!ids.has(c.id)) forgetFlashStarted(c.id)
      const clips = usePlaybackStore.getState().timelineClips
      const keptClips = clips.every(c => ids.has(c.cuelistId)) ? clips : clips.filter(c => ids.has(c.cuelistId))
      usePlaybackStore.setState({ cuelists, timelineClips: keptClips })
      break
    }
    case 'chases':
      usePlaybackStore.setState({ chases: next as Chase[] })
      break
    case 'effects': {
      const effects = next as Effect[]
      if (onConsole) {
        const before = new Map((prev as Effect[]).map(e => [e.id, e]))
        const ids = new Set(effects.map(e => e.id))
        for (const e of prev as Effect[]) if (e.isRunning && !ids.has(e.id)) stopEffect(e.id)
        for (const e of effects) {
          const old = before.get(e.id)
          // Edited while running: new parameters, same phase
          if (e.isRunning && old && old !== e) startEffect(e, { restart: false })
        }
      }
      useEffectsStore.setState({ effects })
      break
    }
    case 'midiMappings':
      useMidiStore.getState().setMappings(next as SectionData['midiMappings'])
      break
    case 'executor': {
      const { grid, columns, modes, pages } = next as SectionData['executor']
      useExecutorStore.getState().applyRemote(pages ? { pages } : { grid, columns, modes })
      break
    }
    case 'macros':
      usePoolStore.setState({ macros: next as SectionData['macros'] })
      break
    case 'speedMasters':
      usePoolStore.setState({ speedMasters: next as SectionData['speedMasters'] })
      break
    case 'stagePages':
      usePoolStore.setState({ stagePages: next as SectionData['stagePages'] })
      break
    case 'parked':
      usePoolStore.setState({ parked: next as SectionData['parked'] })
      break
    case 'timeline': {
      const t = next as TimelineContent
      const p = prev as TimelineContent
      const patch: Obj = {}
      if (t.clips !== p.clips) patch.timelineClips = t.clips
      if (t.markers !== p.markers) patch.timelineMarkers = t.markers
      if (t.zones !== p.zones) patch.timelineZones = t.zones
      if (t.trackCount !== p.trackCount) patch.timelineTrackCount = t.trackCount
      if (t.trackNames !== p.trackNames) patch.timelineTrackNames = t.trackNames
      if (Object.keys(patch).length > 0) usePlaybackStore.setState(patch)
      setTimelineTotalDuration(t.length)
      setTimelineLooping(t.loop)
      break
    }
    case 'roomConfig':
      useVisualizerStore.setState({ roomConfig: next as SectionData['roomConfig'] })
      break
  }
}

function cuelistIdSet(): Set<string> {
  return new Set(usePlaybackStore.getState().cuelists.map(c => c.id))
}

/** Objects executor cells may point at (cells of deleted objects are emptied) */
function executorRefs(): ExecutorRefIds {
  const pb = usePlaybackStore.getState()
  const pool = usePoolStore.getState()
  return {
    chase: new Set(pb.chases.map(c => c.id)),
    effect: new Set(useEffectsStore.getState().effects.map(e => e.id)),
    macro: new Set(pool.macros.map(m => m.id)),
    group: new Set(usePatchStore.getState().groups.map(g => g.id)),
    speed: new Set(pool.speedMasters.map(m => m.id))
  }
}

type ValueSection = keyof ContentValues

/** Patch ↔ groups references stay consistent after either changed */
function reconcileGroups(): void {
  const { patch, groups } = usePatchStore.getState()
  const fixed = reconcilePatchGroups(patch, groups)
  if (fixed.patch !== patch || fixed.groups !== groups) usePatchStore.setState({ patch: fixed.patch, groups: fixed.groups })
}

/** Next value of a section after a remote diff (console side). */
function mergeChange(section: ContentSection, change: SectionChange): unknown {
  const current = readSection(section)
  if (isListSection(section)) {
    const upsert = normalizeSectionItems(section, Array.isArray(change.upsert) ? change.upsert : [])
    const remove = Array.isArray(change.remove) ? change.remove.filter((id): id is string => typeof id === 'string') : []
    const order = Array.isArray(change.order) ? change.order.filter((id): id is string => typeof id === 'string') : undefined
    return applyListChange(section as ListSection, current as ContentItems[ListSection][], upsert as ContentItems[ListSection][], remove, order)
  }
  if (change.value === undefined) return current
  return replaceValue(current, normalizeSectionValue(section as ValueSection, change.value, cuelistIdSet(), executorRefs()))
}

/** Next value of a section from the console's full copy (remote side). */
function mergeFull(section: ContentSection, data: unknown): unknown {
  const current = readSection(section)
  if (isListSection(section)) {
    return replaceList(section as ListSection, current as ContentItems[ListSection][], normalizeSectionItems(section, data) as ContentItems[ListSection][])
  }
  return replaceValue(current, normalizeSectionValue(section as ValueSection, data, cuelistIdSet(), executorRefs()))
}

/**
 * Apply section diffs to the LOCAL stores as a local edit (undo / redo,
 * lib/history.ts). Same merge as a remote edit: items that stay keep their
 * runtime state (a playing scene keeps playing), removed ones are released,
 * re-added ones come back stopped. On the console the content tracking
 * versions it like any local edit; on a remote it is sent to the console
 * like any local edit.
 */
export function applySectionChanges(changes: Partial<Record<ContentSection, SectionChange>>): void {
  const sections = CONTENT_SECTIONS.filter(s => changes[s])
  for (const s of sections) {
    try {
      commitSection(s, mergeChange(s, changes[s]!) as never)
    } catch (e) {
      console.error(`[Content] could not apply "${s}":`, e)
    }
  }
  if (sections.includes('patch') || sections.includes('groups')) reconcileGroups()
}

/**
 * True while content that is NOT a local edit is written into the stores:
 * a remote's edit merged on the console, the console's copy applied on a
 * remote. Undo history ignores those changes (each device undoes its own).
 */
export function isApplyingExternalContent(): boolean {
  return mergingRemote > 0 || applyingConsole > 0
}

// ---------------------------------------------------------------
// Console: revisions
// ---------------------------------------------------------------

const epoch = uuidv4()
const revisions: Record<string, ContentRevision> = Object.fromEntries(CONTENT_SECTIONS.map(s => [s, { rev: 0 }]))
const appliedSeq = new Map<string, number>()
const stateListeners = new Set<() => void>()
/** >0 while a remote payload is merged: changes are bumped once, attributed to it */
let mergingRemote = 0
const changedWhileMerging = new Set<ContentSection>()

function notifyContentState(): void {
  for (const l of stateListeners) {
    try { l() } catch (e) { console.error('[Content] listener failed:', e) }
  }
}

function bump(section: ContentSection, by?: string, seq?: number): void {
  const next: ContentRevision = { rev: revisions[section].rev + 1 }
  if (by !== undefined) { next.by = by; next.seq = seq }
  revisions[section] = next
}

/** Revision state for the state snapshot (console). */
export function getContentState(): ContentState {
  return { epoch, sections: { ...revisions } }
}

/** Called when a section revision changes (state broadcast). Returns an unsubscribe fn. */
export function onContentStateChange(listener: () => void): () => void {
  stateListeners.add(listener)
  return () => { stateListeners.delete(listener) }
}

/** Watch every content section of the stores; returns a stop function. Console only. */
function watchContent(onChange: (sections: ContentSection[]) => void): () => void {
  let last = readAllSections()
  const check = (sections: readonly ContentSection[]) => {
    const changed: ContentSection[] = []
    for (const s of sections) {
      const cur = readSection(s)
      if (!sameSection(s, last[s] as never, cur as never)) changed.push(s)
      ;(last as unknown as Record<string, unknown>)[s] = cur
    }
    if (changed.length > 0) onChange(changed)
  }
  const unsubs = [
    usePatchStore.subscribe((s, p) => { if (s.patch !== p.patch || s.groups !== p.groups) check(['patch', 'groups']) }),
    usePlaybackStore.subscribe((s, p) => {
      if (s.presets !== p.presets || s.cuelists !== p.cuelists || s.chases !== p.chases ||
          s.timelineClips !== p.timelineClips || s.timelineMarkers !== p.timelineMarkers || s.timelineZones !== p.timelineZones ||
          s.timelineTrackCount !== p.timelineTrackCount || s.timelineTrackNames !== p.timelineTrackNames) {
        check(['presets', 'cuelists', 'chases', 'timeline'])
      }
    }),
    useEffectsStore.subscribe((s, p) => { if (s.effects !== p.effects) check(['effects']) }),
    useMidiStore.subscribe((s, p) => { if (s.mappings !== p.mappings) check(['midiMappings']) }),
    useExecutorStore.subscribe((s, p) => { if (s.pages !== p.pages) check(['executor']) }),
    useVisualizerStore.subscribe((s, p) => { if (s.roomConfig !== p.roomConfig) check(['roomConfig']) }),
    usePoolStore.subscribe((s, p) => {
      if (s.macros !== p.macros || s.speedMasters !== p.speedMasters || s.stagePages !== p.stagePages || s.parked !== p.parked) {
        check(['macros', 'speedMasters', 'stagePages', 'parked'])
      }
    }),
    onTimelineSettingsChange(() => check(['timeline']))
  ]
  return () => { for (const u of unsubs) u() }
}

/** Console: version every content change (local edits, show loads, remote merges). */
export function installContentTracking(): () => void {
  if (isRemoteMode()) return () => {}
  return watchContent((sections) => {
    if (mergingRemote > 0) {
      for (const s of sections) changedWhileMerging.add(s)
      return
    }
    for (const s of sections) bump(s)
    notifyContentState()
  })
}

/** Run `fn` (a console-side content operation) and bump these sections exactly once each. */
export function withContentBump(sections: ContentSection[], fn: () => void, by?: string, seq?: number): void {
  mergingRemote++
  try {
    fn()
  } finally {
    mergingRemote--
  }
  const all = new Set<ContentSection>([...sections])
  if (mergingRemote === 0) {
    for (const s of changedWhileMerging) all.add(s)
    changedWhileMerging.clear()
  }
  for (const s of all) {
    // Sections the payload named are attributed to it (even when nothing changed:
    // the remote counts on one revision per section it sent); side effects are not
    if (sections.includes(s)) bump(s, by, seq)
    else bump(s)
  }
  if (all.size > 0) notifyContentState()
}

/**
 * Console: merge a remote's 'apply-show-content' payload into the running
 * show. Playback is never stopped. Returns false for a malformed payload.
 */
export function applyContentFromRemote(payload: unknown): boolean {
  if (!isObj(payload) || !isObj(payload.sections)) return false
  const origin = typeof payload.origin === 'string' && payload.origin.length <= 64 ? payload.origin : undefined
  const seq = typeof payload.seq === 'number' && Number.isFinite(payload.seq) ? payload.seq : undefined
  const raw = payload.sections as Record<string, unknown>
  const sections = CONTENT_SECTIONS.filter(s => isObj(raw[s]))
  if (sections.length === 0) return false
  withContentBump(sections, () => {
    for (const s of sections) {
      try {
        commitSection(s, mergeChange(s, raw[s] as SectionChange) as never)
      } catch (e) {
        console.error(`[Content] could not merge "${s}" from a remote:`, e)
      }
      if (s === 'patch' || s === 'groups') reconcileGroups()
    }
  }, origin, seq)
  if (origin && seq !== undefined) appliedSeq.set(origin, Math.max(appliedSeq.get(origin) ?? 0, seq))
  if (sections.includes('patch')) reloadLibraryForUnknownTypes()
  return true
}

/**
 * A remote patched fixture types it installed into the console's library
 * (offline catalog, file import): the console's copy of the library must
 * know them before the mixer can drive those fixtures.
 */
function reloadLibraryForUnknownTypes(): void {
  const { patch, fixtures } = usePatchStore.getState()
  const known = new Set(fixtures.map(f => f.id))
  if (patch.every(p => known.has(p.fixtureDefId))) return
  usePatchStore.getState().loadFixtures().catch((e) => console.warn('[Content] fixture library reload failed:', e))
}

/** Console: the current show content for a remote (show:get-current). */
export function collectCurrentContent(origin?: string, sections?: string[]): CurrentShowContent {
  const show = collectShowData()
  const { timecode: _tc, ...timeline } = show.timeline ?? { clips: [], markers: [], zones: [], trackCount: 3 }
  const all: Record<ContentSection, unknown> = {
    patch: show.patch,
    groups: show.groups,
    presets: show.presets,
    cuelists: show.cuelists,
    chases: show.chases,
    effects: show.effects,
    midiMappings: show.midiMappings,
    executor: show.executor,
    timeline: { ...timeline, length: getTimelineState().totalDuration, loop: getTimelineState().isLooping },
    roomConfig: show.roomConfig,
    macros: show.macros ?? [],
    speedMasters: show.speedMasters ?? [],
    stagePages: show.stagePages ?? [],
    parked: show.parked ?? []
  }
  const wanted = Array.isArray(sections) && sections.length > 0 ? CONTENT_SECTIONS.filter(s => sections.includes(s)) : CONTENT_SECTIONS
  const out: Record<string, unknown> = { name: show.name, createdAt: show.createdAt, version: show.version }
  for (const s of wanted) out[s] = all[s]
  return {
    success: true,
    show: out,
    content: getContentState(),
    appliedSeq: origin ? appliedSeq.get(origin) ?? 0 : 0
  }
}

// ---------------------------------------------------------------
// Remote: send local edits, fetch the console's
// ---------------------------------------------------------------

export const CONTENT_DEBOUNCE_MS = 150

/** Stable id of this remote page */
const origin = uuidv4()
let seq = 0
/** What the console has (as far as we know): the reference for diffs. null until loaded. */
let baseline: SectionData | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
/** >0 while console data is applied locally: not an edit */
let applyingConsole = 0
let knownEpoch: string | null = null
const knownRev: Record<string, number> = {}
/** Seqs sent per section, not yet seen in a revision */
const inFlight: Record<string, number[]> = {}
/** Sections fetched while our edits were in flight (kept local): refetch once their revision moves past this */
const stale = new Map<string, number>()
let lastConsoleState: ContentState | null = null
let fetching = false

export function getRemoteOrigin(): string {
  return origin
}

function rebase(sections: readonly ContentSection[] = CONTENT_SECTIONS): void {
  if (!baseline) return
  for (const s of sections) (baseline as unknown as Record<string, unknown>)[s] = readSection(s)
}

/** Remote: send every pending local edit now. */
export function flushContentNow(): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (!baseline || !isRemoteMode()) return
  const changes: Record<string, SectionChange> = {}
  for (const s of CONTENT_SECTIONS) {
    const cur = readSection(s)
    const change = diffSection(s, baseline[s] as never, cur as never)
    if (change) changes[s] = change
    ;(baseline as unknown as Record<string, unknown>)[s] = cur
  }
  const names = Object.keys(changes)
  if (names.length === 0) return
  seq++
  for (const s of names) (inFlight[s] ??= []).push(seq)
  const payload: ApplyShowContentPayload = { origin, seq, sections: changes, baseRevisions: { ...knownRev } }
  sendRemoteCommand('apply-show-content', payload)
}

function scheduleFlush(): void {
  if (applyingConsole > 0 || !baseline || flushTimer) return
  flushTimer = setTimeout(() => { flushTimer = null; flushContentNow() }, CONTENT_DEBOUNCE_MS)
}

/** Remote: run a local change that mirrors what the console is doing (optimistic, never sent). */
export function runAsConsoleContent(sections: readonly ContentSection[], fn: () => void): void {
  flushContentNow()
  applyingConsole++
  try {
    withoutDirtyTracking(fn)
  } finally {
    applyingConsole--
  }
  rebase(sections)
}

function markKnown(state: ContentState, sections: readonly string[]): void {
  knownEpoch = state.epoch
  for (const s of sections) knownRev[s] = state.sections[s]?.rev ?? 0
}

/**
 * Pure decision (exported for tests): which sections must be fetched for
 * this console content state, and which revisions we produced ourselves.
 */
export function planContentFetch(
  state: ContentState,
  known: { epoch: string | null; rev: Record<string, number>; inFlight: Record<string, number[]>; stale: Map<string, number> },
  me: string
): { fetch: string[]; adopt: { section: string; rev: number; seq: number }[] } {
  if (state.epoch !== known.epoch) return { fetch: [...CONTENT_SECTIONS], adopt: [] }
  const fetch: string[] = []
  const adopt: { section: string; rev: number; seq: number }[] = []
  for (const s of CONTENT_SECTIONS) {
    const r = state.sections[s]
    if (!r) continue
    const k = known.rev[s] ?? 0
    if (r.rev <= k) continue // revisions only grow: an older broadcast
    const staleAt = known.stale.get(s)
    if (staleAt !== undefined) {
      // Wait until the console applied our edits (its revision moves on)
      if (r.rev > staleAt) fetch.push(s)
      continue
    }
    const mine = known.inFlight[s] ?? []
    const upTo = typeof r.seq === 'number' ? mine.filter(x => x <= r.seq!) : []
    // Exactly our own sends since what we know, the last one being ours: nothing new for us
    if (r.by === me && typeof r.seq === 'number' && mine.includes(r.seq) && r.rev - k === upTo.length) {
      adopt.push({ section: s, rev: r.rev, seq: r.seq })
    } else {
      fetch.push(s)
    }
  }
  return { fetch, adopt }
}

/** Remote: a state broadcast carried the console's content revisions. */
export function onConsoleContentState(raw: unknown): void {
  if (!isRemoteMode() || !isObj(raw) || typeof raw.epoch !== 'string' || !isObj(raw.sections)) return
  const state = raw as unknown as ContentState
  lastConsoleState = state
  if (!baseline) {
    // The startup load failed (console busy / not ready): try again, at most every 5 s
    if (bootAttempted && !booting && Date.now() - lastBootAttempt > 5000) void loadConsoleShow()
    return
  }
  if (fetching) return // the running fetch re-checks when done
  const plan = planContentFetch(state, { epoch: knownEpoch, rev: knownRev, inFlight, stale }, origin)
  for (const a of plan.adopt) {
    knownRev[a.section] = a.rev
    inFlight[a.section] = (inFlight[a.section] ?? []).filter(x => x > a.seq)
  }
  if (plan.fetch.length > 0) void fetchSections(plan.fetch)
}

async function fetchSections(sections: string[]): Promise<void> {
  const bridge = getBridge()
  if (!bridge || fetching) return
  fetching = true
  try {
    const result = await bridge.show.getCurrent({ origin, sections })
    if (result?.success && result.show && result.content) applyConsoleSections(result, sections)
  } catch (e) {
    console.warn('[Content] fetch from the console failed:', e)
  } finally {
    fetching = false
  }
  // Something may have changed meanwhile (stale / older revisions are ignored, no loop)
  if (lastConsoleState) onConsoleContentState(lastConsoleState)
}

/**
 * Pure decision (exported for tests): sections of a fetch result to apply.
 * A section we sent edits for that the console had not applied yet is kept
 * as is locally (and refetched later) — applying it would undo our edit.
 */
export function sectionsToApply(sections: readonly string[], applied: number, mine: Record<string, number[]>): { apply: string[]; skip: string[] } {
  const apply: string[] = []
  const skip: string[] = []
  for (const s of sections) {
    if ((mine[s] ?? []).some(x => x > applied)) skip.push(s)
    else apply.push(s)
  }
  return { apply, skip }
}

function applyConsoleSections(result: CurrentShowContent, requested: string[]): void {
  const show = result.show!
  const content = result.content!
  const newEpoch = content.epoch !== knownEpoch
  // Our pending edits go first (they are then "in flight")
  flushContentNow()
  const present = requested.filter(s => isContentSection(s) && show[s] !== undefined) as ContentSection[]
  const { apply, skip } = newEpoch
    ? { apply: present as string[], skip: [] as string[] }
    : sectionsToApply(present, result.appliedSeq ?? 0, inFlight)
  const ordered = CONTENT_SECTIONS.filter(s => apply.includes(s))
  applyingConsole++
  try {
    withoutDirtyTracking(() => {
      for (const s of ordered) {
        try {
          commitSection(s, mergeFull(s, show[s]) as never)
        } catch (e) {
          console.error(`[Content] could not apply "${s}" from the console:`, e)
        }
      }
      if (ordered.includes('patch') || ordered.includes('groups')) reconcileGroups()
    })
  } finally {
    applyingConsole--
  }
  rebase(ordered)
  if (newEpoch) {
    knownEpoch = content.epoch
    for (const s of CONTENT_SECTIONS) { inFlight[s] = []; stale.delete(s) }
  }
  markKnown(content, ordered)
  for (const s of ordered) {
    inFlight[s] = (inFlight[s] ?? []).filter(x => x > (result.appliedSeq ?? 0))
    stale.delete(s)
  }
  for (const s of skip) stale.set(s, content.sections[s]?.rev ?? 0)
}

/**
 * Remote startup: load the show the console is running RIGHT NOW (not a
 * file — unsaved console changes included). Never echoed back.
 */
let booting = false
let bootAttempted = false
let lastBootAttempt = 0

export async function loadConsoleShow(): Promise<ShowIoResult> {
  const bridge = getBridge()
  if (!bridge) return { status: 'error', error: t('file.errors.notConnected') }
  if (booting) return { status: 'busy' }
  booting = true
  bootAttempted = true
  lastBootAttempt = Date.now()
  try {
    const result = await bridge.show.getCurrent({ origin })
    if (!result?.success || !result.show || !result.content) {
      return { status: 'error', error: result?.error || t('file.errors.consoleNoShow') }
    }
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    applyingConsole++
    try {
      withoutDirtyTracking(() => { applyShowData(result.show) })
    } finally {
      applyingConsole--
    }
    baseline = readAllSections()
    knownEpoch = result.content.epoch
    markKnown(result.content, CONTENT_SECTIONS)
    for (const s of CONTENT_SECTIONS) { inFlight[s] = []; stale.delete(s) }
    if (lastConsoleState) onConsoleContentState(lastConsoleState)
    return { status: 'ok', name: typeof result.show.name === 'string' ? result.show.name : undefined }
  } catch (e) {
    console.error('[Content] could not load the console show:', e)
    return { status: 'error', error: e instanceof Error ? e.message : String(e) }
  } finally {
    booting = false
  }
}

/** Remote: watch local edits and send them to the console. Returns a stop function. */
export function installRemoteContentSync(): () => void {
  if (!isRemoteMode()) return () => {}
  const onEdit = () => scheduleFlush()
  const unsubs = [
    usePatchStore.subscribe((s, p) => { if (s.patch !== p.patch || s.groups !== p.groups) onEdit() }),
    usePlaybackStore.subscribe((s, p) => {
      if (s.presets !== p.presets || s.cuelists !== p.cuelists || s.chases !== p.chases ||
          s.timelineClips !== p.timelineClips || s.timelineMarkers !== p.timelineMarkers || s.timelineZones !== p.timelineZones ||
          s.timelineTrackCount !== p.timelineTrackCount || s.timelineTrackNames !== p.timelineTrackNames) onEdit()
    }),
    useEffectsStore.subscribe((s, p) => { if (s.effects !== p.effects) onEdit() }),
    useMidiStore.subscribe((s, p) => { if (s.mappings !== p.mappings) onEdit() }),
    useExecutorStore.subscribe((s, p) => { if (s.pages !== p.pages) onEdit() }),
    useVisualizerStore.subscribe((s, p) => { if (s.roomConfig !== p.roomConfig) onEdit() }),
    usePoolStore.subscribe((s, p) => {
      if (s.macros !== p.macros || s.speedMasters !== p.speedMasters || s.stagePages !== p.stagePages || s.parked !== p.parked) onEdit()
    }),
    onTimelineSettingsChange(onEdit),
    // A show opened / uploaded from this remote: the console adopts the same file
    onShowApplied(() => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
      rebase()
    })
  ]
  // A command never overtakes the edit it depends on (create a scene, then GO it)
  setRemoteCommandPreflight(() => { if (flushTimer) flushContentNow() })
  // Edits sent while the link was down never arrived: start again from the console's copy
  let wasOpen = true
  const offConn = getBridge()?.remote.onConnectionChange((state) => {
    if (state !== 'open') { wasOpen = false; return }
    if (wasOpen) return
    wasOpen = true
    if (!baseline) return
    for (const s of CONTENT_SECTIONS) inFlight[s] = []
    stale.clear()
    knownEpoch = null // next broadcast → full refetch
  })
  return () => {
    offConn?.()
    for (const u of unsubs) u()
    setRemoteCommandPreflight(null)
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  }
}

/** Test helper: reset the remote-side bookkeeping. */
export function __resetContentSyncForTests(): void {
  baseline = null
  knownEpoch = null
  seq = 0
  for (const k of Object.keys(knownRev)) delete knownRev[k]
  for (const k of Object.keys(inFlight)) delete inFlight[k]
  stale.clear()
  lastConsoleState = null
  fetching = false
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
}
