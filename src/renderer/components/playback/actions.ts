// ============================================================
// Delete / duplicate / rename for the Scenes view: scenes, cues,
// chases and chase steps. Every delete goes through deleteWithUndo
// (danger confirm, one undo step, "Deleted: … — Undo" toast), so the
// trash buttons, "…" menus and the Delete / Backspace key behave the
// same. Duplicates are one named undo step.
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import type { Chase, ChaseStep, Cue, Cuelist } from '@shared/types'
import { t } from '@renderer/i18n'
import { formatShortcut } from '@renderer/components/ui/Kbd'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { historyStep } from '@renderer/lib/history'
import { deleteWithUndo, type SelectionActions } from '@renderer/lib/selection-actions'

const pb = usePlaybackStore.getState

/** 1 → "1", 2.5 → "2.5", 1.25 → "1.25" (a cue number is an identifier: dot in every language, like grandMA) */
export function formatCueNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
}

const undoHint = () => t('edit.confirmDeleteMessage', { keys: formatShortcut('Mod+Z') })

/** Focus and select an inline name field ([data-name-field="…"]) — F2 / Enter / "Rename" */
export function focusNameField(id: string): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>(`[data-name-field="${CSS.escape(id)}"]`)
    if (!el) return
    el.focus()
    el.select()
  })
}

function named(list: { id: string; name: string }[], id: string): string {
  return list.find((x) => x.id === id)?.name ?? ''
}

// ---------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------

export function sceneLabel(cl: Pick<Cuelist, 'name'>): string {
  return t('scenes.selection.scene', { name: cl.name || t('common.untitled') })
}

function removeSceneNow(id: string): void {
  const list = pb().cuelists
  const at = list.findIndex((c) => c.id === id)
  const neighbour = list[at + 1] ?? list[at - 1]
  pb().removeCuelist(id)
  pb().selectCuelist(neighbour?.id ?? null)
}

function sceneConfirm(cl: Cuelist) {
  const fx = cl.effectSnapshots?.length ?? 0
  const cues = t('common.cueCount', { count: cl.cues.length })
  const contents = fx > 0
    ? t('scenes.delete.sceneContentsFx', { cues, effects: t('scenes.effectCount', { count: fx }) })
    : t('scenes.delete.sceneContents', { cues })
  return { message: `${contents} ${undoHint()}`, confirmLabel: t('scenes.delete.sceneAction') }
}

/** Delete a scene (confirm + undo); the next scene in the list gets selected */
export function deleteScene(cl: Cuelist): Promise<boolean> {
  return deleteWithUndo({ label: sceneLabel(cl), confirm: sceneConfirm(cl), run: () => removeSceneNow(cl.id) })
}

function duplicateSceneNow(id: string): string | null {
  const name = named(pb().cuelists, id)
  const newId = pb().duplicateCuelist(id)
  if (newId) {
    pb().renameCuelist(newId, t('scenes.copyName', { name }))
    pb().selectCuelist(newId)
  }
  return newId
}

/** Copy of a scene right after it, selected; returns the new id */
export function duplicateScene(cl: Cuelist): string | null {
  let id: string | null = null
  historyStep(t('shell.editMenu.duplicateWhat', { what: sceneLabel(cl) }), () => { id = duplicateSceneNow(cl.id) })
  return id
}

export function sceneSelectionActions(cl: Cuelist): SelectionActions {
  return {
    label: () => sceneLabel(cl),
    delete: () => removeSceneNow(cl.id),
    confirmDelete: sceneConfirm(cl),
    duplicate: () => { duplicateSceneNow(cl.id) },
    rename: () => focusNameField(`scene:${cl.id}`)
  }
}

// ---------------------------------------------------------------
// Cues
// ---------------------------------------------------------------

export function cueLabel(cue: Pick<Cue, 'number' | 'name'>): string {
  const number = formatCueNumber(cue.number)
  return cue.name ? t('scenes.selection.cueNamed', { number, name: cue.name }) : t('scenes.selection.cue', { number })
}

/** Cue to select once `cueId` is gone (the next one, else the previous one) */
function neighbourCue(cuelistId: string, cueId: string): string | null {
  const cues = pb().cuelists.find((c) => c.id === cuelistId)?.cues ?? []
  const at = cues.findIndex((c) => c.id === cueId)
  return (cues[at + 1] ?? cues[at - 1])?.id ?? null
}

function removeCueNow(cuelistId: string, cueId: string, onSelect?: (id: string | null) => void): void {
  const next = neighbourCue(cuelistId, cueId)
  pb().removeCue(cuelistId, cueId)
  onSelect?.(next)
}

function cueConfirm(cue: Cue) {
  return {
    message: `${t('scenes.delete.cueContents', { count: cue.values.length })} ${undoHint()}`,
    confirmLabel: t('scenes.delete.cueAction')
  }
}

/** Delete a cue (confirm + undo). `onSelect` receives the cue to select next. */
export function deleteCue(cuelistId: string, cue: Cue, onSelect?: (id: string | null) => void): Promise<boolean> {
  return deleteWithUndo({ label: cueLabel(cue), confirm: cueConfirm(cue), run: () => removeCueNow(cuelistId, cue.id, onSelect) })
}

/** Copy a cue right after it (number between its neighbours); returns the new id */
function duplicateCueNow(cuelistId: string, cueId: string): string | null {
  const cl = pb().cuelists.find((c) => c.id === cuelistId)
  const index = cl ? cl.cues.findIndex((c) => c.id === cueId) : -1
  if (!cl || index < 0) return null
  const src = cl.cues[index]
  const id = uuidv4()
  pb().addCue(cuelistId, src.name, src.values.map((v) => ({ ...v })), src.fadeIn, src.fadeOut, id)
  pb().updateCue(cuelistId, id, { delay: src.delay, followTime: src.followTime })
  if (index + 1 < cl.cues.length) pb().moveCue(cuelistId, cl.cues.length, index + 1)
  return id
}

export function duplicateCue(cuelistId: string, cue: Cue): string | null {
  let id: string | null = null
  historyStep(t('shell.editMenu.duplicateWhat', { what: cueLabel(cue) }), () => { id = duplicateCueNow(cuelistId, cue.id) })
  return id
}

export function cueSelectionActions(cuelistId: string, cue: Cue, onSelect: (id: string | null) => void): SelectionActions {
  return {
    label: () => cueLabel(cue),
    delete: () => removeCueNow(cuelistId, cue.id, onSelect),
    confirmDelete: cueConfirm(cue),
    duplicate: () => {
      const id = duplicateCueNow(cuelistId, cue.id)
      if (id) onSelect(id)
    },
    rename: () => focusNameField(`cue:${cue.id}`)
  }
}

// ---------------------------------------------------------------
// Chases
// ---------------------------------------------------------------

export function chaseLabel(ch: Pick<Chase, 'name'>): string {
  return t('scenes.selection.chase', { name: ch.name || t('common.untitled') })
}

function removeChaseNow(id: string): void {
  const list = pb().chases
  const at = list.findIndex((c) => c.id === id)
  const neighbour = list[at + 1] ?? list[at - 1]
  pb().removeChase(id)
  pb().selectChase(neighbour?.id ?? null)
}

function chaseConfirm(ch: Chase) {
  return {
    message: `${t('scenes.delete.chaseContents', { steps: t('scenes.stepCount', { count: ch.steps.length }) })} ${undoHint()}`,
    confirmLabel: t('scenes.delete.chaseAction')
  }
}

export function deleteChase(ch: Chase): Promise<boolean> {
  return deleteWithUndo({ label: chaseLabel(ch), confirm: chaseConfirm(ch), run: () => removeChaseNow(ch.id) })
}

/** Copy of a chase (appended to the list); returns the new id */
function duplicateChaseNow(id: string): string | null {
  const src = pb().chases.find((c) => c.id === id)
  if (!src) return null
  const newId = pb().addChase(t('scenes.copyName', { name: src.name }))
  pb().updateChase(newId, {
    isLooping: src.isLooping, bpm: src.bpm, fadePercent: src.fadePercent, direction: src.direction, faderLevel: src.faderLevel, priority: src.priority
  })
  for (const step of src.steps) {
    const stepId = uuidv4()
    pb().addChaseStep(newId, step.values.map((v) => ({ ...v })), stepId)
    if (step.holdTime !== undefined) pb().updateChaseStep(newId, stepId, { holdTime: step.holdTime })
  }
  pb().selectChase(newId)
  return newId
}

export function duplicateChase(ch: Chase): string | null {
  let id: string | null = null
  historyStep(t('shell.editMenu.duplicateWhat', { what: chaseLabel(ch) }), () => { id = duplicateChaseNow(ch.id) })
  return id
}

export function chaseSelectionActions(ch: Chase): SelectionActions {
  return {
    label: () => chaseLabel(ch),
    delete: () => removeChaseNow(ch.id),
    confirmDelete: chaseConfirm(ch),
    duplicate: () => { duplicateChaseNow(ch.id) },
    rename: () => focusNameField(`chase:${ch.id}`)
  }
}

// ---------------------------------------------------------------
// Chase steps
// ---------------------------------------------------------------

export function stepLabel(index: number): string {
  return t('scenes.selection.step', { n: index + 1 })
}

function neighbourStep(chaseId: string, stepId: string): string | null {
  const steps = pb().chases.find((c) => c.id === chaseId)?.steps ?? []
  const at = steps.findIndex((s) => s.id === stepId)
  return (steps[at + 1] ?? steps[at - 1])?.id ?? null
}

function removeStepNow(chaseId: string, stepId: string, onSelect?: (id: string | null) => void): void {
  const next = neighbourStep(chaseId, stepId)
  pb().removeChaseStep(chaseId, stepId)
  onSelect?.(next)
}

/** An empty step is cheap to recreate: no confirm */
function stepConfirm(step: ChaseStep) {
  return step.values.length === 0
    ? false
    : { message: `${t('scenes.delete.stepContents', { count: step.values.length })} ${undoHint()}`, confirmLabel: t('scenes.delete.stepAction') }
}

export function deleteStep(chaseId: string, step: ChaseStep, index: number, onSelect?: (id: string | null) => void): Promise<boolean> {
  return deleteWithUndo({ label: stepLabel(index), confirm: stepConfirm(step), run: () => removeStepNow(chaseId, step.id, onSelect) })
}

/** Copy a step right after it; returns the new id */
function duplicateStepNow(chaseId: string, stepId: string): string | null {
  const ch = pb().chases.find((c) => c.id === chaseId)
  const index = ch ? ch.steps.findIndex((s) => s.id === stepId) : -1
  if (!ch || index < 0) return null
  const src = ch.steps[index]
  const id = uuidv4()
  pb().addChaseStep(chaseId, src.values.map((v) => ({ ...v })), id)
  if (src.holdTime !== undefined) pb().updateChaseStep(chaseId, id, { holdTime: src.holdTime })
  if (index + 1 < ch.steps.length) pb().moveChaseStep(chaseId, ch.steps.length, index + 1)
  return id
}

export function duplicateStep(chaseId: string, step: ChaseStep, index: number): string | null {
  let id: string | null = null
  historyStep(t('shell.editMenu.duplicateWhat', { what: stepLabel(index) }), () => { id = duplicateStepNow(chaseId, step.id) })
  return id
}

export function stepSelectionActions(chaseId: string, step: ChaseStep, index: number, onSelect: (id: string | null) => void): SelectionActions {
  return {
    label: () => stepLabel(index),
    delete: () => removeStepNow(chaseId, step.id, onSelect),
    confirmDelete: stepConfirm(step),
    duplicate: () => {
      const id = duplicateStepNow(chaseId, step.id)
      if (id) onSelect(id)
    }
  }
}
