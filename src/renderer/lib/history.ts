// ============================================================
// PhotonBoard — Undo / redo of show CONTENT
//
// What is recorded: every change to the content sections of the show
// (patch, groups, presets, scenes & cues, chases, effect definitions,
// MIDI mappings, executor layout, timeline, stage layout — the
// section model of shared/show-format.ts). Runtime state (a scene
// playing, a fader level, a running effect, the programmer) is NOT
// content and is never undone.
//
// How: a snapshot of each section (store values are immutable, so a
// snapshot is a set of references). A change opens a pending step
// holding the "before" of the sections it touched; rapid edits are
// coalesced into that step until the stores have been idle for
// HISTORY_IDLE_MS (a fader drag, typing a name) — and for as long as
// a pointer drag holds the gate (lib/history-gate.ts). Max
// HISTORY_LIMIT steps.
//
// Undo / redo apply the DIFF of the step (by item id, like a remote
// edit — lib/content-sync.ts applySectionChanges): only the items the
// step touched change, playing scenes keep playing, removed items are
// released, re-added items come back stopped. Playback never stops.
//
// Not recorded: show loads (history cleared), content arriving from
// another device (a remote's edit on the console, the console's copy
// on a remote): each device undoes ITS OWN edits. On a remote the
// undo is a local edit, sent to the console like any other.
// ============================================================

import { create } from 'zustand'
import { CONTENT_SECTIONS, type ContentSection } from '@shared/show-format'
import type { SectionChange } from '@shared/remote-commands'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { showToast } from '@renderer/stores/toast-store'
import { t } from '@renderer/i18n'
import { formatShortcut } from '@renderer/components/ui/Kbd'
import { diffSection, sameSection, type SectionData } from './content-merge'
import { applySectionChanges, isApplyingExternalContent, readAllSections, readSection } from './content-sync'
import { isApplyingShow, onShowApplied } from './show-io'
import { onTimelineSettingsChange } from './timeline-engine'
import { isHistoryHeld, onHistoryRelease } from './history-gate'

export const HISTORY_LIMIT = 100
export const HISTORY_IDLE_MS = 400

type Snapshot = Partial<Record<ContentSection, unknown>>

interface Step {
  id: number
  /** Explicit label ("Delete scene “Intro”"); default derived from the sections, in the current language */
  label?: string
  before: Snapshot
  after: Snapshot
  time: number
}

/** What the UI may know about a step */
export interface HistoryStepInfo {
  id: number
  label: string
  sections: ContentSection[]
}

export interface HistoryUiState {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
}

/** Undo / redo availability for buttons and menus (re-renders on change). */
export const useHistoryStore = create<HistoryUiState>(() => ({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null }))

let past: Step[] = []
let future: Step[] = []
let current: SectionData | null = null
let pending: { before: Snapshot; label?: string } | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let restoring = 0
let stepSeq = 0
let installed: (() => void) | null = null

/** Sections in the order that names a step best (the side effects come last) */
const LABEL_PRIORITY: ContentSection[] = [
  'cuelists', 'chases', 'effects', 'patch', 'presets', 'groups', 'midiMappings', 'timeline', 'roomConfig', 'executor'
]

function sectionsOf(step: Step): ContentSection[] {
  return CONTENT_SECTIONS.filter(s => s in step.before)
}

function labelOf(step: Step): string {
  if (step.label) return step.label
  const sections = sectionsOf(step)
  const main = LABEL_PRIORITY.find(s => sections.includes(s))
  return main ? t(`edit.sections.${main}`) : t('edit.severalSections')
}

function info(step: Step): HistoryStepInfo {
  return { id: step.id, label: labelOf(step), sections: sectionsOf(step) }
}

function publish(): void {
  const last = past[past.length - 1]
  const next = future[future.length - 1]
  // A pending step counts as undoable (it is committed first)
  const canUndo = !!last || !!pending
  useHistoryStore.setState({
    canUndo,
    canRedo: !!next && !pending,
    undoLabel: pending ? (pending.label ?? null) : last ? labelOf(last) : null,
    redoLabel: next && !pending ? labelOf(next) : null
  })
}

function clearTimer(): void {
  if (timer) { clearTimeout(timer); timer = null }
}

function schedule(): void {
  clearTimer()
  if (isHistoryHeld()) return // committed when the gesture ends
  timer = setTimeout(() => { timer = null; commitPending() }, HISTORY_IDLE_MS)
}

/** Re-read sections into the reference snapshot without recording anything. */
function rebase(sections: readonly ContentSection[] = CONTENT_SECTIONS): void {
  if (!current) return
  for (const s of sections) (current as unknown as Snapshot)[s] = readSection(s)
}

/** Store changes for these sections (subscription callback). */
function onContentChange(sections: readonly ContentSection[]): void {
  if (!current) return
  if (restoring > 0 || isApplyingShow() || isApplyingExternalContent()) {
    // Our own edit in progress on these sections ends here (`current` still
    // holds its result): the other device's change is not part of it
    if (restoring === 0 && pending && sections.some(s => s in pending!.before)) commitPending()
    rebase(sections)
    return
  }
  let changed = false
  for (const s of sections) {
    const cur = readSection(s)
    const prev = (current as unknown as Snapshot)[s]
    if (prev === cur || sameSection(s, prev as never, cur as never)) {
      ;(current as unknown as Snapshot)[s] = cur // runtime-only change: keep the newest reference
      continue
    }
    if (!pending) pending = { before: {} }
    if (!(s in pending.before)) pending.before[s] = prev
    ;(current as unknown as Snapshot)[s] = cur
    changed = true
  }
  if (changed) {
    schedule()
    publish()
  }
}

/** Close the pending step now (undo, a labelled step, the idle timer). Returns it, or null when it changed nothing. */
function commitPending(): Step | null {
  clearTimer()
  const p = pending
  pending = null
  if (!p || !current) { publish(); return null }
  const before: Snapshot = {}
  const after: Snapshot = {}
  for (const s of CONTENT_SECTIONS) {
    if (!(s in p.before)) continue
    const now = (current as unknown as Snapshot)[s]
    if (sameSection(s, p.before[s] as never, now as never)) continue // edited back to where it was
    before[s] = p.before[s]
    after[s] = now
  }
  if (Object.keys(before).length === 0) { publish(); return null }
  const step: Step = { id: ++stepSeq, label: p.label, before, after, time: Date.now() }
  past.push(step)
  if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT)
  future = []
  publish()
  return step
}

/** Write one side of a step back into the stores (as a diff from the other side). */
function applyStep(step: Step, to: 'before' | 'after'): void {
  const from = to === 'before' ? step.after : step.before
  const target = to === 'before' ? step.before : step.after
  const changes: Partial<Record<ContentSection, SectionChange>> = {}
  for (const s of sectionsOf(step)) {
    const change = diffSection(s, from[s] as never, target[s] as never)
    if (change) changes[s] = change
  }
  restoring++
  try {
    applySectionChanges(changes)
  } finally {
    restoring--
  }
  rebase()
}

// ---------------------------------------------------------------
// Public API
// ---------------------------------------------------------------

export interface UndoOptions {
  /** Show "Undone: …" (default true; false when the caller shows its own feedback) */
  toast?: boolean
}

/** Undo the last step (the pending edit first). Returns it, or null when there is nothing to undo. */
export function undo(opts: UndoOptions = {}): HistoryStepInfo | null {
  commitPending()
  const step = past.pop()
  if (!step) {
    if (opts.toast !== false) showToast('info', t('edit.nothingToUndo'), { id: 'history', duration: 1500 })
    publish()
    return null
  }
  applyStep(step, 'before')
  future.push(step)
  publish()
  const result = info(step)
  if (opts.toast !== false) showToast('info', t('edit.undone', { what: result.label }), { id: 'history', duration: 2500 })
  return result
}

/** Redo the last undone step. */
export function redo(opts: UndoOptions = {}): HistoryStepInfo | null {
  commitPending()
  const step = future.pop()
  if (!step) {
    if (opts.toast !== false) showToast('info', t('edit.nothingToRedo'), { id: 'history', duration: 1500 })
    publish()
    return null
  }
  applyStep(step, 'after')
  past.push(step)
  publish()
  const result = info(step)
  if (opts.toast !== false) showToast('info', t('edit.redone', { what: result.label }), { id: 'history', duration: 2500 })
  return result
}

/** Undo `stepId` only if it is still the last step (an "Undo" button in a toast). */
export function undoStep(stepId: number, opts: UndoOptions = {}): boolean {
  commitPending()
  if (past[past.length - 1]?.id !== stepId) {
    showToast('warning', t('edit.undoGone', { keys: formatShortcut('Mod+Z') }), { id: 'history' })
    return false
  }
  return !!undo(opts)
}

/**
 * Run `fn` (synchronous store changes) as ONE undo step named `label`
 * (e.g. t('edit.deleted', …)). Pending edits are committed first so they
 * stay a separate step. Returns the step (null when `fn` changed nothing).
 */
export function historyStep(label: string, fn: () => void): HistoryStepInfo | null {
  commitPending()
  fn()
  if (pending) pending.label = label
  const step = commitPending()
  return step ? info(step) : null
}

/** Name the step being edited right now (shown in the Undo tooltip / toast). */
export function labelPendingStep(label: string): void {
  if (pending) { pending.label = label; publish() }
}

/** Commit the pending edit now (e.g. before saving). */
export function flushHistory(): void {
  commitPending()
}

/** Forget everything (show load / new show). */
export function clearHistory(): void {
  clearTimer()
  past = []
  future = []
  pending = null
  current = installed ? readAllSections() : null
  publish()
}

export function canUndo(): boolean {
  return past.length > 0 || !!pending
}

export function canRedo(): boolean {
  return future.length > 0 && !pending
}

/** Steps for tests / debugging (oldest first). */
export function getHistory(): { past: HistoryStepInfo[]; future: HistoryStepInfo[]; pending: boolean } {
  return { past: past.map(info), future: future.map(info).reverse(), pending: !!pending }
}

/** Start recording (console and remote). Idempotent; returns a stop function. */
export function installHistory(): () => void {
  if (installed) return installed
  current = readAllSections()
  const unsubs = [
    usePatchStore.subscribe((s, p) => { if (s.patch !== p.patch || s.groups !== p.groups) onContentChange(['patch', 'groups']) }),
    usePlaybackStore.subscribe((s, p) => {
      if (s.presets !== p.presets || s.cuelists !== p.cuelists || s.chases !== p.chases ||
          s.timelineClips !== p.timelineClips || s.timelineMarkers !== p.timelineMarkers || s.timelineZones !== p.timelineZones ||
          s.timelineTrackCount !== p.timelineTrackCount || s.timelineTrackNames !== p.timelineTrackNames) {
        onContentChange(['presets', 'cuelists', 'chases', 'timeline'])
      }
    }),
    useEffectsStore.subscribe((s, p) => { if (s.effects !== p.effects) onContentChange(['effects']) }),
    useMidiStore.subscribe((s, p) => { if (s.mappings !== p.mappings) onContentChange(['midiMappings']) }),
    useExecutorStore.subscribe((s, p) => { if (s.grid !== p.grid || s.columns !== p.columns || s.modes !== p.modes) onContentChange(['executor']) }),
    useVisualizerStore.subscribe((s, p) => { if (s.roomConfig !== p.roomConfig) onContentChange(['roomConfig']) }),
    onTimelineSettingsChange(() => onContentChange(['timeline'])),
    onShowApplied(() => clearHistory()),
    onHistoryRelease(() => { if (pending) schedule() })
  ]
  const stop = () => {
    for (const u of unsubs) u()
    clearTimer()
    installed = null
    current = null
    pending = null
    past = []
    future = []
    publish()
  }
  installed = stop
  publish()
  return stop
}
