// ============================================================
// Library tab — browse fixture types (built-in, user, OFL, GDTF),
// read their modes and channels, patch, edit, delete, import,
// download from the Open Fixture Library.
// ============================================================

import { useMemo, useState } from 'react'
import { LuCopy, LuFileUp, LuGlobe, LuLibrary, LuPencil, LuPencilRuler, LuPlus, LuTrash2 } from 'react-icons/lu'
import type { FixtureDefinition } from '@shared/types'
import { Button, EmptyState, Modal, ResizeHandle, confirm, toast, useResizable } from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { canImportFiles, importFixtureFiles } from './patch-hooks'
import { LibraryBrowser } from './LibraryBrowser'
import { FixtureDetails } from './FixtureDetails'
import { FixtureEditor, editorModeFor } from './FixtureEditor'
import { OFLSearchPanel } from './OFLSearchPanel'

type EditorState = { fixture?: FixtureDefinition; asCopy: boolean } | null

export function LibraryView({ onPatch }: { onPatch: (defId: string) => void }) {
  const fixtures = usePatchStore((s) => s.fixtures)
  const patch = usePatchStore((s) => s.patch)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState>(null)
  const [online, setOnline] = useState(false)
  const side = useResizable({ initial: 360, min: 280, max: 560, storageKey: 'patch.library' })

  const def = useMemo(() => fixtures.find((f) => f.id === selectedId) ?? null, [fixtures, selectedId])
  const patchedCount = useMemo(() => (def ? patch.filter((p) => p.fixtureDefId === def.id).length : 0), [patch, def])

  const remove = async (d: FixtureDefinition) => {
    if (patchedCount > 0) {
      toast.warning(`${d.name} is in use`, { description: `Delete or change the ${patchedCount} patched fixture${patchedCount === 1 ? '' : 's'} first.` })
      return
    }
    const ok = await confirm({
      title: `Delete “${d.name}” from the library?`,
      message: 'The definition file is removed from your user library. Patched shows that use it will show it as missing.',
      confirmLabel: 'Delete fixture type',
      tone: 'danger'
    })
    if (!ok) return
    try {
      const res = await window.photonboard.fixtures.delete(d.id)
      if (res && res.success === false) { toast.error('Not deleted', { description: res.error }); return }
      await usePatchStore.getState().loadFixtures()
      setSelectedId(null)
      toast.success(`${d.name} deleted`)
    } catch (e) {
      toast.error('Not deleted', { description: (e as Error).message })
    }
  }

  const importFiles = async () => {
    const ids = await importFixtureFiles()
    if (ids.length > 0) setSelectedId(ids[0])
  }

  const builtin = !!def && (!def.source || def.source === 'builtin')

  return (
    <div className="flex h-full min-h-0">
      <div className="flex shrink-0 flex-col border-r border-line bg-surface-1" style={{ width: side.size }}>
        <div className="flex h-control-lg shrink-0 items-center gap-1 border-b border-line-subtle px-2">
          <Button size="sm" variant="ghost" icon={LuPencilRuler} onClick={() => setEditor({ asCopy: false })}>New type</Button>
          {canImportFiles() && <Button size="sm" variant="ghost" icon={LuFileUp} onClick={() => { void importFiles() }} tooltip="GDTF, QLC+ (.qxf), OFL JSON, Avolites, CSV…">Import</Button>}
          <Button size="sm" variant="ghost" icon={LuGlobe} onClick={() => setOnline(true)}>Online</Button>
        </div>
        <LibraryBrowser
          className="flex-1"
          selectedId={selectedId}
          onSelect={(d) => setSelectedId(d.id)}
          onActivate={(d) => onPatch(d.id)}
          emptyAction={<Button size="sm" variant="primary" icon={LuGlobe} onClick={() => setOnline(true)}>Search online</Button>}
        />
      </div>
      <ResizeHandle {...side.handleProps} />
      <div className="min-w-0 flex-1">
        {def ? (
          <FixtureDetails
            def={def}
            patchedCount={patchedCount}
            actions={(
              <>
                {builtin ? (
                  <Button size="sm" variant="ghost" icon={LuCopy} onClick={() => setEditor(editorModeFor(def))} tooltip="Built-in types are read-only: edit your own copy">Edit a copy</Button>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" icon={LuPencil} onClick={() => setEditor(editorModeFor(def))}>Edit</Button>
                    <Button size="sm" variant="danger-outline" icon={LuTrash2} onClick={() => { void remove(def) }}>Delete</Button>
                  </>
                )}
                <Button size="sm" variant="primary" icon={LuPlus} onClick={() => onPatch(def.id)}>Patch…</Button>
              </>
            )}
          />
        ) : (
          <EmptyState
            icon={LuLibrary}
            title="Select a fixture type"
            description="See its modes and DMX channels, patch it, or edit your own fixture types. Import GDTF, QLC+ or OFL files, or download from the Open Fixture Library."
            action={<Button variant="secondary" icon={LuGlobe} onClick={() => setOnline(true)}>Search online library</Button>}
          />
        )}
      </div>

      {editor && (
        <FixtureEditor
          fixture={editor.fixture}
          asCopy={editor.asCopy}
          onClose={() => setEditor(null)}
          onSaved={(d) => setSelectedId(d.id)}
        />
      )}
      {online && (
        <Modal open size="md" flush title="Open Fixture Library" description="Download fixture definitions into your library." onClose={() => setOnline(false)}>
          <div className="flex h-[min(560px,calc(100vh-220px))] flex-col border-t border-line-subtle">
            <OFLSearchPanel className="flex-1" onFixtureDownloaded={(d) => { setSelectedId(d.id); setOnline(false) }} />
          </div>
        </Modal>
      )}
    </div>
  )
}
