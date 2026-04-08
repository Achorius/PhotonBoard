import React, { useState, useCallback, useEffect, useRef } from 'react'
import { usePlaybackStore } from '../../stores/playback-store'

const COLUMN_COUNT = 8
const ROWS_PER_COLUMN = 4

const DEFAULT_COLUMN_COLORS = [
  '#e85d04', '#22c55e', '#3b82f6', '#a855f7',
  '#ef4444', '#eab308', '#06b6d4', '#f97316'
]

const COLOR_PALETTE = [
  '#e85d04', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#06b6d4', '#3b82f6', '#a855f7',
  '#ec4899', '#6b7280', '#ffffff', '#8b5cf6'
]

interface ColumnMeta {
  title: string
  color: string
}

export function ExecutorBar() {
  const { cuelists, goCuelist, stopCuelist, renameCuelist } = usePlaybackStore()

  // Column metadata (title + color)
  const [columns, setColumns] = useState<ColumnMeta[]>(() =>
    Array.from({ length: COLUMN_COUNT }, (_, i) => ({
      title: '',
      color: DEFAULT_COLUMN_COLORS[i]
    }))
  )

  // Grid state: [col][row] → cuelist id or null
  const [grid, setGrid] = useState<(string | null)[][]>(() =>
    Array.from({ length: COLUMN_COUNT }, () =>
      Array.from({ length: ROWS_PER_COLUMN }, () => null)
    )
  )

  // Editing state
  const [editingTitle, setEditingTitle] = useState<number | null>(null)
  const [editingScene, setEditingScene] = useState<{ col: number; row: number } | null>(null)
  const [colorPicker, setColorPicker] = useState<number | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const sceneInputRef = useRef<HTMLInputElement>(null)

  // Sync: when cuelists change, place new ones in first available slot
  useEffect(() => {
    const currentPlaced = new Set<string>()
    for (const col of grid) {
      for (const cell of col) {
        if (cell) currentPlaced.add(cell)
      }
    }

    const newCuelists = cuelists.filter(cl => !currentPlaced.has(cl.id))
    const validIds = new Set(cuelists.map(c => c.id))
    const hasDeleted = Array.from(currentPlaced).some(id => !validIds.has(id))

    if (newCuelists.length === 0 && !hasDeleted) return

    setGrid(prev => {
      const newGrid = prev.map(c => [...c])

      // Clear deleted
      for (let col = 0; col < COLUMN_COUNT; col++) {
        for (let row = 0; row < ROWS_PER_COLUMN; row++) {
          if (newGrid[col][row] && !validIds.has(newGrid[col][row]!)) {
            newGrid[col][row] = null
          }
        }
      }

      // Place new
      let idx = 0
      for (let col = 0; col < COLUMN_COUNT && idx < newCuelists.length; col++) {
        for (let row = 0; row < ROWS_PER_COLUMN && idx < newCuelists.length; row++) {
          if (!newGrid[col][row]) {
            newGrid[col][row] = newCuelists[idx].id
            idx++
          }
        }
      }
      return newGrid
    })
  }, [cuelists])

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
    setGrid(prev => {
      const newGrid = prev.map(c => [...c])
      const sourceId = newGrid[dragSource.col][dragSource.row]
      const targetId = newGrid[col][row]
      newGrid[col][row] = sourceId
      newGrid[dragSource.col][dragSource.row] = targetId
      return newGrid
    })
    setDragSource(null)
    setDragOver(null)
  }, [dragSource])

  const handleDragEnd = useCallback(() => {
    setDragSource(null)
    setDragOver(null)
  }, [])

  const getCuelist = (id: string | null) => id ? cuelists.find(c => c.id === id) : null

  const updateColumnTitle = (col: number, title: string) => {
    setColumns(prev => {
      const updated = [...prev]
      updated[col] = { ...updated[col], title }
      return updated
    })
  }

  const updateColumnColor = (col: number, color: string) => {
    setColumns(prev => {
      const updated = [...prev]
      updated[col] = { ...updated[col], color }
      return updated
    })
    setColorPicker(null)
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

                return (
                  <div
                    key={row}
                    draggable={!isEditing}
                    onDragStart={(e) => handleDragStart(e, col, row)}
                    onDragOver={(e) => handleDragOver(e, col, row)}
                    onDrop={() => handleDrop(col, row)}
                    onDragEnd={handleDragEnd}
                    className={`flex-1 rounded flex items-center min-h-0 transition-all ${
                      !isEditing ? 'cursor-grab active:cursor-grabbing' : ''
                    } ${isDragSource_ ? 'opacity-30 scale-95' : ''} ${isDragTarget ? 'ring-1' : ''}`}
                    style={{
                      backgroundColor: isActive ? colColor + '25' : colColor + '10',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderColor: isActive ? colColor + '70' : colColor + '25',
                      ...(isDragTarget ? { ringColor: colColor } : {})
                    }}
                    title={isEditing ? '' : `${scene.name} — Click: ${isActive ? 'stop' : 'GO'} | Double-click: rename | Drag: move`}
                  >
                    {/* Status dot */}
                    <div
                      className="h-full flex items-center pl-1.5 cursor-pointer"
                      onClick={() => isActive ? stopCuelist(scene.id) : goCuelist(scene.id)}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'animate-pulse' : ''}`}
                        style={{ backgroundColor: isActive ? '#22c55e' : colColor + '60' }}
                      />
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
