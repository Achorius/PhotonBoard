// Placeholder of the in-app "Stage" view (Pro): user touch pages of
// executors, faders, macros, presets… WP7 (executor pages & live
// surfaces) owns this file and replaces it with the designer / renderer.

import { LuLayoutDashboard } from 'react-icons/lu'
import { EmptyState } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'

export function StagePagesView() {
  const t = useT()
  return (
    <div className="flex h-full flex-col">
      <EmptyState icon={LuLayoutDashboard} title={t('pro.pools.nav.stage.title')} />
    </div>
  )
}
