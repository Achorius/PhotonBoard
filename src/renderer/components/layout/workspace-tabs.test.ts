import { describe, expect, it } from 'vitest'
import { WORKSPACE_TABS, isProOnlyTab, railTabs } from './workspace-tabs'

describe('workspace rail', () => {
  it('simple view: the workspace tabs, unchanged', () => {
    expect(railTabs(false).map((t) => t.id)).toEqual(WORKSPACE_TABS.map((t) => t.id))
  })

  it('pro view: Pools after Effects (Program), Stage after Timeline (Playback), no digit shortcut', () => {
    const tabs = railTabs(true)
    const ids = tabs.map((t) => t.id)
    expect(ids.indexOf('pools')).toBe(ids.indexOf('effects') + 1)
    expect(ids.indexOf('stage')).toBe(ids.indexOf('live') + 1)
    expect(tabs.find((t) => t.id === 'pools')).toMatchObject({ group: 'Program', labelKey: 'pro.pools.nav.pools.label' })
    expect(tabs.find((t) => t.id === 'pools')!.shortcut).toBeUndefined()
    expect(isProOnlyTab('pools')).toBe(true)
    expect(isProOnlyTab('fixtures')).toBe(false)
  })
})
