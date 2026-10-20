// Attribute programmer for the selection: Intensity always visible on
// the left, feature tabs (Position / Colour / Beam / Control / All) on
// the right. Tabs only exist for features the selection has; a dot on a
// tab = something of that feature is in the programmer.
// Pro view: preset rows (Dimmer + the open tab's families) above the panel.

import { memo, useMemo } from 'react'
import type { FixtureDefinition } from '@shared/types'
import { LuAperture, LuLayoutGrid, LuMove, LuPalette, LuSettings2 } from 'react-icons/lu'
import { Tabs, type TabItem } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { useAnyTouched } from './attr-actions'
import { presetFamiliesFor, type Attribute, type ProgrammerModel } from './programmer-model'
import { useProgrammerView, type FeatureTab } from './programmer-view-store'
import { IntensityPanel } from './IntensityPanel'
import { PositionPanel } from './PositionPanel'
import { ColourPanel } from './ColourPanel'
import { AllAttributesPanel, FeaturePanel } from './FeaturePanel'
import { featureLabel } from './labels'
import { useUiStore } from '@renderer/stores/ui-store'
import { PresetRows } from './PresetRow'

const TAB_ORDER: FeatureTab[] = ['position', 'colour', 'beam', 'control', 'all']

function TabLabel({ label, attrs }: { label: string; attrs: Attribute[] }) {
  const t = useT()
  const touched = useAnyTouched(attrs)
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {touched && <span aria-label={t('fixtures.features.inProgrammer')} className="h-1.5 w-1.5 rounded-full bg-accent" />}
    </span>
  )
}

export const ProgrammerAttributes = memo(function ProgrammerAttributes({ model, defs }: {
  model: ProgrammerModel
  defs: Map<string, FixtureDefinition>
}) {
  const t = useT()
  const requested = useProgrammerView((s) => s.tab)
  const f = model.byFeature
  const count = model.entries.length
  const firstName = model.entries[0]?.name ?? ''

  const items: TabItem<FeatureTab>[] = [
    { id: 'position', icon: LuMove, label: <TabLabel label={featureLabel('position', t)} attrs={f.position} />, disabled: f.position.length === 0 },
    { id: 'colour', icon: LuPalette, label: <TabLabel label={featureLabel('colour', t)} attrs={f.colour} />, disabled: f.colour.length === 0 },
    { id: 'beam', icon: LuAperture, label: <TabLabel label={featureLabel('beam', t)} attrs={f.beam} />, disabled: f.beam.length === 0 },
    { id: 'control', icon: LuSettings2, label: <TabLabel label={featureLabel('control', t)} attrs={f.control} />, disabled: f.control.length === 0 },
    { id: 'all', icon: LuLayoutGrid, label: t('common.all'), badge: model.attributes.length }
  ]
  const enabled = (id: FeatureTab) => !items.find((i) => i.id === id)?.disabled
  const tab: FeatureTab = enabled(requested) ? requested : TAB_ORDER.find(enabled) ?? 'all'

  const intensity = f.intensity[0]
  const proMode = useUiStore((s) => s.proMode)
  const families = useMemo(() => (proMode ? presetFamiliesFor(tab, f) : []), [proMode, tab, f])

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
          <Tabs items={items} value={tab} onChange={(id) => useProgrammerView.getState().setTab(id)} aria-label={t('fixtures.features.aria')} />
        </div>
        {proMode && <PresetRows families={families} className="border-b border-line-subtle px-3 py-2" />}
        <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
          {tab === 'position' && <PositionPanel model={model} defs={defs} firstName={firstName} />}
          {tab === 'colour' && <ColourPanel model={model} firstName={firstName} />}
          {tab === 'beam' && <FeaturePanel attrs={f.beam} selectionCount={count} firstName={firstName} feature="beam" />}
          {tab === 'control' && <FeaturePanel attrs={f.control} selectionCount={count} firstName={firstName} feature="control" />}
          {tab === 'all' && <AllAttributesPanel byFeature={f} selectionCount={count} firstName={firstName} />}
        </div>
      </div>
    </div>
  )
})
