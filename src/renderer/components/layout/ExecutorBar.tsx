import React, { useState, useCallback, useEffect, useRef } from 'react'
import { usePlaybackStore } from '../../stores/playback-store'
import { useMidiStore } from '../../stores/midi-store'
import {
  useExecutorStore,
  COLUMN_COUNT,
  ROWS_PER_COLUMN,
  type SceneMode
} from '../../stores/executor-store'

const COLOR_PALETTE = [
  '#e85d04', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#06b6d4', '#3b82f6', '#a855f7',
  '#ec4899', '#6b7280', '#ffffff', '#8b5cf6'
]

const MODE_LABELS: Record<SceneMode, string> = { toggle: 'TOG', trigger: 'TRIG', flash: 'FLASH' }
const MODE_CYCLE: SceneMode[] = ['toggle', 'trigger', 'flash']
const MODE_DESCRIPTIONS: Record<SceneMode, string> = {
  toggle: 'Toggle — GO / STOP alternés',
  trigger: 'Trigger — Joue tant qu\'on appuie',
  flash: 'Flash — Plein fader tant qu\'on appuie'
}

export function ExecutorBar() {
  const { cuelists, goCuelist, stopCuelist, renameCuelist } = usePlaybackStore()
  const { mappings, isLearning, learnTarget, startLearn, cancelLearn, updateMapping } = useMidiStore()

  // Executor layout from shared store (broadcast to Stage + remote)
  const grid = useExecutorStore(s => s.grid)
  const columns = useExecutorStore(s => s.columns)
  const modes = useExecutorStore(s => s.modes)
  const swapCellsAction = useExecutorStore(s => s.swapCells)
  const syncCuelistsAction = useExecutorStore(s => s.syncCuelists)
  const setColumnTitleAction = useExecutorStore(s => s.setColumnTitle)
  const setColumnColorAction = useExecutorStore(s => s.setColumnColor)
  const setModeAction = useExecutorStore(s => s.setMode)

  // Get MIDI mapping for a cuelist
  const getMidiMapping = (cuelistId: string) =>
    mappings.find(m => m.target.type === 'cuelist_go' && m.target.id === cuelistId)
  const isLearningScene = (cuelistId: string) =>
    isLearning && learnTarget?.type === 'cuelist_go' && learnTarget?.id === cuelistId

  // Editing state
  const [editingTitle, setEditingTitle] = useState<number | null>(null)
  const [editingScene, setEditingScene] = useState<{ col: number; row: number } | null>(null)
  const [colorPicker, setColorPicker] = useState<number | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const sceneInputRef = useRef<HTMLInputElement>(null)

  // Sync: when cuelists change, place new ones in first available slot
  useEffect(() => {
    syncCuelistsAction(cuelists.map(c => c.id))
  }, [cuelists, syncCuelistsAction])

  // Focus inputs when editing starts
  useEffect(() => {
    if (editingTitle !== null) titleInputRef.current?.focus()
  }, [editingTitle])
  useEffect(() => {
    if (editingScene) sceneInputRef.current?.focus()
  }, [editingScene])

  // Drag state
  const [dragSource, setDragSource] = useState<{ col: number; row: number } | null>(null)
  const [dragOver, setDragOver] = useState<{ col: number; row: number } | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, col: number, row: number) => {
    setDragSource({ col, row })
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, col: number, row: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver({ col, row })
  }, [])

  const handleDrop = useCallback((col: number, row: number) => {
    if (!dragSource) return
    swapCellsAction(dragSource, { col, row })
    setDragSource(null)
    setDragOver(null)
  }, [dragSource, swapCellsAction])

  const handleDragEnd = useCallback(() => {
    setDragSource(null)
    setDragOver(null)
  }, [])

  const getCuelist = (id: string | null) => id ? cuelists.find(c => c.id === id) : null

  const updateColumnTitle = (col: number, title: string) => {
    setColumnTitleAction(col, title)
  }

  const updateColumnColor = (col: number, color: string) => {
    setColumnColorAction(col, color)
    setColorPicker(null)
  }

  // Cycle mode for a cell and update existing MIDI mapping behavior
  const cycleMode = (col: number, row: number) => {
    const currentMode = modes[col][row]
    const nextIdx = (MODE_CYCLE.indexOf(currentMode) + 1) % MODE_CYCLE.length
    const nextMode = MODE_CYCLE[nextIdx]

    setModeAction(col, row, nextMode)

    // Update existing MIDI mapping behavior to match
    const sceneId = grid[col]?.[row]
    if (sceneId) {
      const mapping = getMidiMapping(sceneId)
      if (mapping) {
        updateMapping(mapping.id, {
          options: { ...mapping.options, behavior: nextMode }
        })
      }
    }
  }

  // Right-click: MIDI Learn
  const handleContextMenu = (e: React.MouseEvent, sceneId: string, sceneName: string, col: number, row: number) => {
    e.preventDefault()
    e.stopPropagation()
    if (isLearningScene(sceneId)) {
      cancelLearn()
    } else {
      const mode = modes[col][row]
      startLearn({ type: 'cuelist_go', id: sceneId, label: sceneName })
      // After learn completes, the behavior will be set by completeLearn
      // We need to update it to the cell's mode after mapping is created
      // Use a timeout to let completeLearn finish first
      const unwatch = useMidiStore.subscribe((state) => {
        if (!state.isLearning && state.learnTarget === null) {
          // Learn just completed — update the new mapping's behavior
          const newMapping = state.mappings.find(m => m.target.type === 'cuelist_go' && m.target.id === sceneId)
          if (newMapping && newMapping.options.behavior !== mode) {
            setTimeout(() => {
              useMidiStore.getState().updateMapping(newMapping.id, {
                options: { ...newMapping.options, behavior: mode }
              })
            }, 0)
          }
          unwatch()
        }
      })
    }
  }

  return (
    <div className="bg-surface-1 border-t-2 border-surface-3 shrink-0" style={{ height: 156 }}>
      <div className="flex h-full gap-px p-px">
        {Array.from({ length: COLUMN_COUNT }, (_, col) => {
          const colMeta = columns[col]
          const colColor = colMeta.color

          return (
            <div key={col} className="flex-1 flex flex-col min-w-0 gap-px">
              {/* Column header */}
              <div
                className="h-5 shrink-0 rounded-t flex items-center px-1 gap-1 cursor-pointer relative"
                style={{ backgroundColor: colColor + '30', borderBottom: `2px solid ${colColor}50` }}
              >
                {/* Color dot — click to open palette */}
                <button
                  className="w-2.5 h-2.5 rounded-full shrink-0 hover:scale-125 transition-transform"
                  style={{ backgroundColor: colColor }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setColorPicker(colorPicker === col ? null : col)
                  }}
                  title="Change column color"
                />

                {/* Title — double-click to edit */}
                {editingTitle === col ? (
                  <input
                    ref={titleInputRef}
                    className="flex-1 bg-transparent text-[9px] text-gray-200 outline-none min-w-0 font-medium"
                    value={colMeta.title}
                    onChange={(e) => updateColumnTitle(col, e.target.value)}
                    onBlur={() => setEditingTitle(null)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setEditingTitle(null) }}
                    placeholder={`Col ${col + 1}`}
                  />
                ) : (
                  <span
                    className="flex-1 text-[9px] truncate min-w-0 font-medium"
                    style={{ color: colMeta.title ? colColor : '#555' }}
                    onDoubleClick={() => setEditingTitle(col)}
                    title="Double-click to rename"
                  >
                    {colMeta.title || `${col + 1}`}
                  </span>
                )}

                {/* Color picker dropdown */}
                {colorPicker === col && (
                  <div
                    className="absolute top-full left-0 mt-0.5 z-50 bg-surface-2 border border-surface-3 rounded p-1 flex flex-wrap gap-0.5"
                    style={{ width: 80 }}
                    onMouseLeave={() => setColorPicker(null)}
                  >
                    {COLOR_PALETTE.map((c) => (
                      <button
                        key={c}
                        className={`w-4 h-4 rounded hover:scale-110 transition-transform ${c === colColor ? 'ring-1 ring-white' : ''}`}
                        style={{ backgroundColor: c }}
                        onClick={() => updateColumnColor(col, c)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Scene rows */}
              {Array.from({ length: ROWS_PER_COLUMN }, (_, row) => {
                const sceneId = grid[col]?.[row] ?? null
                const scene = getCuelist(sceneId)
                const isDragTarget = dragOver?.col === col && dragOver?.row === row
                const isDragSource_ = dragSource?.col === col && dragSource?.row === row
                const isEditing = editingScene?.col === col && editingScene?.row === row

                if (!scene) {
                  return (
                    <div
                      key={row}
                      className={`flex-1 rounded flex items-center justify-center min-h-0 transition-colors ${
                        isDragTarget
                          ? 'border border-dashed'
                          : 'bg-surface-0 border border-surface-2'
                      }`}
                      style={isDragTarget ? { borderColor: colColor + '80', backgroundColor: colColor + '15' } : undefined}
                      onDragOver={(e) => handleDragOver(e, col, row)}
                      onDrop={() => handleDrop(col, row)}
                    />
                  )
                }

                const isActive = scene.isPlaying
                const midiMap = getMidiMapping(scene.id)
                const learning = isLearningScene(scene.id)
                const cellMode = modes[col][row]

                return (
                  <div
                    key={row}
                    draggable={!isEditing}
                    onDragStart={(e) => handleDragStart(e, col, row)}
                    onDragOver={(e) => handleDragOver(e, col, row)}
                    onDrop={() => handleDrop(col, row)}
                    onDragEnd={handleDragEnd}
                    onContextMenu={(e) => handleContextMenu(e, scene.id, scene.name, col, row)}
                    className={`flex-1 rounded flex items-center min-h-0 transition-all ${
                      !isEditing ? 'cursor-grab active:cursor-grabbing' : ''
                    } ${isDragSource_ ? 'opacity-30 scale-95' : ''} ${isDragTarget ? 'ring-1' : ''} ${
                      learning ? 'ring-1 ring-purple-500 animate-pulse' : ''
                    }`}
                    style={{
                      backgroundColor: isActive ? colColor + '25' : colColor + '10',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderColor: learning ? '#a855f7' : isActive ? colColor + '70' : colColor + '25',
                      ...(isDragTarget ? { ringColor: colColor } : {})
                    }}
                    title={isEditing ? '' : `${scene.name} — Click: ${isActive ? 'stop' : 'GO'} | Double-click: rename | Right-click: MIDI Learn | Drag: move`}
                  >
                    {/* Status dot + MIDI indicator */}
                    <div
                      className="h-full flex items-center pl-1 gap-0.5 cursor-pointer"
                      onClick={() => isActive ? stopCuelist(scene.id) : goCuelist(scene.id)}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'animate-pulse' : ''}`}
                        style={{ backgroundColor: isActive ? '#22c55e' : colColor + '60' }}
                      />
                      {/* Small purple dot if MIDI mapped */}
                      {midiMap && !learning && (
                        <span
                          className="w-1 h-1 rounded-full shrink-0"
                          style={{ backgroundColor: '#a855f7' }}
                          title={`MIDI: ${midiMap.source.type.toUpperCase()} ch${midiMap.source.channel} #${midiMap.source.number}`}
                        />
                      )}
                    </div>

                    {/* Name — click to GO, double-click to rename */}
                    {isEditing ? (
                      <input
                        ref={sceneInputRef}
                        className="flex-1 bg-transparent text-[9px] text-gray-200 outline-none min-w-0 px-1"
                        value={scene.name}
                        onChange={(e) => renameCuelist(scene.id, e.target.value)}
                        onBlur={() => setEditingScene(null)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setEditingScene(null) }}
                      />
                    ) : (
                      <span
                        className="flex-1 min-w-0 px-1 text-[9px] truncate leading-none cursor-pointer"
                        style={{ color: isActive ? '#fff' : colColor + 'cc' }}
                        onClick={() => isActive ? stopCuelist(scene.id) : goCuelist(scene.id)}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          setEditingScene({ col, row })
                        }}
                      >
                        {scene.name}
                      </span>
                    )}

                    {/* Mode selector button */}
                    <button
                      className="shrink-0 px-1 h-4 flex items-center justify-center rounded text-[7px] font-bold mr-0.5 transition-colors bg-surface-2/60 text-gray-500 hover:text-gray-300 hover:bg-surface-3"
                      onClick={(e) => {
                        e.stopPropagation()
                        cycleMode(col, row)
                      }}
                      title={MODE_DESCRIPTIONS[cellMode]}
                    >
                      {MODE_LABELS[cellMode]}
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
