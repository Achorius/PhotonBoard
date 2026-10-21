// ============================================================
// Mounted once in the app shell: the import wizard, the export dialog,
// the drop overlay (a file dragged from the desktop / Finder onto the
// window opens the wizard), and the native File menu entries.
// The OS file drop is not an in-app drag gesture (README §6 Input):
// it works with a mouse / trackpad and has no touch equivalent; the
// File menu (and the USB stick list) is the touch path.
// ============================================================

import { useEffect } from 'react'
import { LuFileInput } from 'react-icons/lu'
import { useT } from '@renderer/i18n'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'
import { ImportWizard } from './ImportWizard'
import { ExportDialog } from './ExportDialog'
import { useInterchangeStore } from './interchange-store'
import { importFile, requestExport, requestImport } from './interchange-actions'

function hasFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types
  return !!types && Array.from(types).includes('Files')
}

export function InterchangeHost() {
  useEffect(() => {
    const bridge = getBridge()
    if (!bridge?.interchange) return
    let depth = 0
    const set = (dragging: boolean) => {
      if (useInterchangeStore.getState().dragging !== dragging) useInterchangeStore.setState({ dragging })
    }
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      set(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      // Without this the browser (and Electron) would open the file instead of handing it to us
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) set(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      set(false)
      const file = e.dataTransfer?.files?.[0]
      // A wizard already applying an import keeps its file
      if (file && useInterchangeStore.getState().step !== 'applying') void importFile(file)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    const offs = !isRemoteMode()
      ? [
        bridge.onMenuEvent('menu:import', () => { void requestImport() }),
        bridge.onMenuEvent('menu:export', () => { requestExport() })
      ]
      : []
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
      for (const off of offs) off()
    }
  }, [])

  return (
    <>
      <ImportWizard />
      <ExportDialog />
      <DropOverlay />
    </>
  )
}

function DropOverlay() {
  const t = useT()
  const dragging = useInterchangeStore((s) => s.dragging)
  if (!dragging) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-modal flex items-center justify-center bg-surface-0/70 p-6" data-drop-overlay>
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-accent bg-surface-overlay px-10 py-8 text-center shadow-modal">
        <LuFileInput size={32} aria-hidden className="text-accent-fg" />
        <span className="text-lg font-semibold text-fg-primary">{t('interchange.drop.title')}</span>
        <span className="text-sm text-fg-secondary">{t('interchange.drop.hint')}</span>
      </div>
    </div>
  )
}
