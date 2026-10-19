// ============================================================
// Faders — channel faders of every fixture on a universe (or raw DMX
// when nothing is patched). The 'faders' tab now opens the unified
// Fixtures & programmer view (its "Faders" mode); this standalone view
// is kept for embedding and uses the same strips.
// ============================================================

import { useMemo } from 'react'
import { SegmentedControl } from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useProgrammerWatch } from '@renderer/lib/programmer-utils'
import { FixtureStrips } from '../fixtures/FixtureStrips'
import { DmxGrid } from '../fixtures/DmxGrid'
import { ChannelMenuProvider } from '../fixtures/channel-menu'

export function FadersView() {
  useProgrammerWatch()
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const universe = useUiStore((s) => s.selectedUniverse)
  const universeCount = useDmxStore((s) => s.universeCount)

  const defs = useMemo(() => new Map(fixtures.map((f) => [f.id, f])), [fixtures])
  const numbers = useMemo(() => new Map(patch.map((p, i) => [p.id, i + 1])), [patch])
  const entries = useMemo(() => patch.filter((p) => p.universe === universe).sort((a, b) => a.address - b.address), [patch, universe])
  const universes = Array.from({ length: Math.max(universeCount, ...patch.map((p) => p.universe + 1), 1) }, (_, i) => i)

  return (
    <ChannelMenuProvider>
      <div className="flex h-full flex-col">
        <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line px-3">
          <h2 className="text-sm font-semibold text-fg-primary">{patch.length > 0 ? 'Fixture faders' : 'Raw DMX'}</h2>
          <div className="flex-1" />
          <SegmentedControl
            size="sm"
            aria-label="Universe"
            value={universe}
            onChange={(u) => useUiStore.getState().setSelectedUniverse(u)}
            items={universes.map((u) => ({ value: u, label: `U${u + 1}`, title: `Universe ${u + 1}` }))}
          />
        </header>
        {patch.length > 0 ? (
          <FixtureStrips
            entries={entries}
            defs={defs}
            numbers={numbers}
            selectedIds={selectedIds}
            emptyTitle={`No fixtures on universe ${universe + 1}`}
            emptyDescription="Pick another universe, or patch fixtures on this one."
          />
        ) : (
          <DmxGrid key={universe} universe={universe} />
        )}
      </div>
    </ChannelMenuProvider>
  )
}
