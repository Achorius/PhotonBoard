// Attribute programmer for the selection: Intensity always visible on
// the left, feature tabs (Position / Colour / Beam / Control / All) on
// the right. Tabs only exist for features the selection has; a dot on a
// tab = something of that feature is in the programmer.

import { memo } from 'react'
import type { FixtureDefinition } from '@shared/types'
import { LuAperture, LuLayoutGrid, LuMove, LuPalette, LuSettings2 } from 'react-icons/lu'
import { Tabs, type TabItem } from '@renderer/components/ui'
import { useAnyTouched } from './attr-actions'
import type { Attribute, ProgrammerModel } from './programmer-model'
import { useProgrammerView, type FeatureTab } from './programmer-view-store'
import { IntensityPanel } from './IntensityPanel'
import { PositionPanel } from './PositionPanel'
import { ColourPanel } from './ColourPanel'
import { AllAttributesPanel, FeaturePanel } from './FeaturePanel'

const TAB_ORDER: FeatureTab[] = ['position', 'colour', 'beam', 'control', 'all']

function TabLabel({ label, attrs }: { label: string; attrs: Attribute[] }) {
  const touched = useAnyTouched(attrs)
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {touched && <span aria-label="in programmer" className="h-1.5 w-1.5 rounded-full bg-accent" />}
    </span>
  )
}

export const ProgrammerAttributes = memo(function ProgrammerAttributes({ model, defs }: {
  model: ProgrammerModel
  defs: Map<string, FixtureDefinition>
}) {
  const requested = useProgrammerView((s) => s.tab)
  const f = model.byFeature
  const count = model.entries.length
  const firstName = model.entries[0]?.name ?? ''

  const items: TabItem<FeatureTab>[] = [
    { id: 'position', icon: LuMove, label: <TabLabel label="Position" attrs={f.position} />, disabled: f.position.length === 0 },
    { id: 'colour', icon: LuPalette, label: <TabLabel label="Colour" attrs={f.colour} />, disabled: f.colour.length === 0 },
    { id: 'beam', icon: LuAperture, label: <TabLabel label="Beam" attrs={f.beam} />, disabled: f.beam.length === 0 },
    { id: 'control', icon: LuSettings2, label: <TabLabel label="Control" attrs={f.control} />, disabled: f.control.length === 0 },
    { id: 'all', icon: LuLayoutGrid, label: 'All', badge: model.attributes.length }
  ]
  const enabled = (t: FeatureTab) => !items.find((i) => i.id === t)?.disabled
  const tab: FeatureTab = enabled(requested) ? requested : TAB_ORDER.find(enabled) ?? 'all'

  const intensity = f.intensity[0]

  return (
    <div className="flex min-h-0 flex-1">
      {intensity && (
        <IntensityPanel
          attr={intensity}
          more={f.intensity.length - 1}
          selectionCount={count}
          firstName={firstName}
          onShowAll={() => useProgrammerView.getState().setTab('all')}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 px-3">
          <Tabs items={items} value={tab} onChange={(t) => useProgrammerView.getState().setTab(t)} aria-label="Attribute features" />
        </div>
        <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
          {tab === 'position' && <PositionPanel model={model} defs={defs} firstName={firstName} />}
          {tab === 'colour' && <ColourPanel model={model} firstName={firstName} />}
          {tab === 'beam' && <FeaturePanel attrs={f.beam} selectionCount={count} firstName={firstName} label="Beam" />}
          {tab === 'control' && <FeaturePanel attrs={f.control} selectionCount={count} firstName={firstName} label="Control" />}
          {tab === 'all' && <AllAttributesPanel byFeature={f} selectionCount={count} firstName={firstName} />}
        </div>
      </div>
    </div>
  )
})
