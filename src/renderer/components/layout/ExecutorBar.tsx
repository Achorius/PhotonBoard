import React, { useState, useCallback, useEffect, useRef } from 'react'
import { usePlaybackStore } from '../../stores/playback-store'

const COLUMN_COUNT = 8
const ROWS_PER_COLUMN = 4

/**
 * ExecutorBar — Ableton-style grid of scene launchers
 * 8 columns x 4 rows. Scenes can be dragged between cells.
 */
export function ExecutorBar() {
  const { cuelists, goCuelist, stopCuelist, setCuelistFader } = usePlaybackStore()

  // Grid state: [col][row] → cuelist id or null
  const [grid, setGrid] = useState<(string | null)[][]>(() =>
    Array.from({ length: COLUMN_COUNT }, () =>
      Array.from({ length: ROWS_PER_COLUMN }, () => null)
    )
  )

  // Track which cuelist ids are already placed in the grid
  const placedIdsRef = useRef<Set<string>>(new Set())

  // Sync: when cuelists change, place any new ones in the first available slot
  useEffect(() => {
    const currentPlaced = new Set<string>()
    // Collect all ids currently in the grid
    for (const col of grid) {
      for (const cell of col) {
        if (cell) currentPlaced.add(cell)
      }
    }

    // Find new cuelists not yet in grid
    const newCuelists = cuelists.filter(cl => !currentPlaced.has(cl.id))
    if (newCuelists.length === 0) {
      placedIdsRef.current = currentPlaced
      return
    }

    // Also remove stale ids (cuelists deleted)
    const validIds = new Set(cuelists.map(c => c.id))

    setGrid(prev => {
      const newGrid = prev.map(c => [...c])

      // Clear deleted cuelists
      for (let col = 0; col < COLUMN_COUNT; col++) {
        for (let row = 0; row < ROWS_PER_COLUMN; row++) {
          if (newGrid[col][row] && !validIds.has(newGrid[col][row]!)) {
            newGrid[col][row] = null
          }
        }
      }

      // Place new cuelists in first empty slot
      let newIdx = 0
      for (let col = 0; col < COLUMN_COUNT && newIdx < newCuelists.length; col++) {
        for (let row = 0; row < ROWS_PER_COLUMN && newIdx < newCuelists.length; row++) {
          if (!newGrid[col][row]) {
            newGrid[col][row] = newCuelists[newIdx].id
            newIdx++
          }
        }
      }

      return newGrid
    })
  }, [cuelists])

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
      // Swap source and target
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

  return (
    <div className="bg-surface-1 border-t-2 border-surface-3 shrink-0" style={{ height: 140 }}>
      <div className="flex h-full gap-px p-px">
        {Array.from({ length: COLUMN_COUNT }, (_, col) => (
          <div key={col} className="flex-1 flex flex-col min-w-0 gap-px">
            {Array.from({ length: ROWS_PER_COLUMN }, (_, row) => {
              const sceneId = grid[col]?.[row] ?? null
              const scene = getCuelist(sceneId)
              const isDragTarget = dragOver?.col === col && dragOver?.row === row
              const isDragSource_ = dragSource?.col === col && dragSource?.row === row

              if (!scene) {
                return (
                  <div
                    key={row}
                    className={`flex-1 rounded flex items-center justify-center min-h-0 transition-colors ${
                      isDragTarget
                        ? 'bg-accent/20 border border-accent/50'
                        : 'bg-surface-0 border border-surface-2'
                    }`}
                    onDragOver={(e) => handleDragOver(e, col, row)}
                    onDrop={() => handleDrop(col, row)}
                  >
                    {row === 0 && (
                      <span className="text-[8px] font-mono text-surface-4 opacity-30">{col + 1}</span>
                    )}
                  </div>
                )
              }

              const isActive = scene.isPlaying

              return (
                <div
                  key={row}
                  draggable
                  onDragStart={(e) => handleDragStart(e, col, row)}
                  onDragOver={(e) => handleDragOver(e, col, row)}
                  onDrop={() => handleDrop(col, row)}
                  onDragEnd={handleDragEnd}
                  className={`flex-1 rounded flex items-center min-h-0 cursor-grab active:cursor-grabbing transition-all ${
                    isDragSource_ ? 'opacity-30 scale-95' : ''
                  } ${isDragTarget ? 'ring-1 ring-accent' : ''} ${
                    isActive
                      ? 'bg-green-900/40 border border-green-500/50'
                      : 'bg-surface-2 border border-surface-3 hover:border-surface-4'
                  }`}
                  title={`${scene.name} — Click to ${isActive ? 'stop' : 'launch'}, drag to move`}
                >
                  {/* Click to GO/STOP */}
                  <div
                    className="flex-1 min-w-0 px-1.5 flex items-center gap-1 cursor-pointer h-full"
                    onClick={() => isActive ? stopCuelist(scene.id) : goCuelist(scene.id)}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isActive ? 'bg-green-400 animate-pulse' : 'bg-gray-600'
                    }`} />
                    <span className="text-[9px] text-gray-300 truncate leading-none">
                      {scene.name}
                    </span>
                  </div>

                  {/* Mini fader */}
                  <input
                    type="range"
                    min={0} max={255}
                    value={scene.faderLevel}
                    onChange={(e) => {
                      e.stopPropagation()
                      setCuelistFader(scene.id, parseInt(e.target.value))
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-8 h-0.5 mr-1 shrink-0 accent-accent cursor-pointer opacity-50 hover:opacity-100"
                    style={{ WebkitAppearance: 'none', height: 2 }}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
