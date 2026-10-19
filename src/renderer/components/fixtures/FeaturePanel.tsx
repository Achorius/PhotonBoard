// Beam / Control (and "All"): attributes with labelled ranges as cards
// (gobo slots, shutter modes, macros), continuous ones as a fader bank.

import { memo } from 'react'
import { LuEraser } from 'react-icons/lu'
import { Button } from '@renderer/components/ui'
import { releaseAttrs, useAnyTouched } from './attr-actions'
import { FEATURES, type Attribute, type Feature } from './programmer-model'
import { AttributeFader, AttributeFaderBank } from './AttributeFader'
import { RangeCard } from './RangeCard'

export interface FeaturePanelProps {
  attrs: Attribute[]
  selectionCount: number
  firstName: string
  label: string
}

export const FeaturePanel = memo(function FeaturePanel({ attrs, selectionCount, firstName, label }: FeaturePanelProps) {
  const anyTouched = useAnyTouched(attrs)
  const cards = attrs.filter((a) => a.ranges.length >= 2)
  const faders = attrs.filter((a) => a.ranges.length < 2)
  return (
    <div className="flex min-h-0 flex-1 gap-4 p-3">
      <div className={cards.length > 0 ? 'flex min-h-0 max-w-[50%] shrink-0 flex-col gap-1.5' : 'flex min-h-0 min-w-0 flex-1 flex-col gap-1.5'}>
        <div className="flex h-control-xs items-center gap-2">
          <span className="flex-1 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{faders.length > 0 ? 'Faders' : ''}</span>
          <Button size="xs" variant="ghost" icon={LuEraser} disabled={!anyTouched} onClick={() => releaseAttrs(attrs)}>
            Release {label.toLowerCase()}
          </Button>
        </div>
        {faders.length > 0 && <AttributeFaderBank attrs={faders} selectionCount={selectionCount} firstName={firstName} className="flex-1" />}
      </div>
      {cards.length > 0 && (
        <div className="min-h-0 min-w-[280px] flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] items-start gap-2.5 [[data-density=touch]_&]:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
            {cards.map((a) => (
              <RangeCard key={a.key} attr={a} selectionCount={selectionCount} firstName={firstName} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

/** Every attribute of the selection as faders, grouped by feature */
export const AllAttributesPanel = memo(function AllAttributesPanel({ byFeature, selectionCount, firstName }: {
  byFeature: Record<Feature, Attribute[]>
  selectionCount: number
  firstName: string
}) {
  const groups = FEATURES.filter((f) => byFeature[f.id].length > 0)
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
      {groups.map((f) => (
        <section key={f.id} aria-label={f.label} className="flex min-h-0 shrink-0 flex-col gap-1.5">
          <span className="px-1 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{f.label}</span>
          <div className="flex min-h-0 flex-1 gap-1.5">
            {byFeature[f.id].map((a) => (
              <AttributeFader key={a.key} attr={a} selectionCount={selectionCount} firstName={firstName} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
})
