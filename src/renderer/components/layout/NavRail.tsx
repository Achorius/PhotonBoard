// Main navigation: vertical rail of workspace views, grouped
// (Setup · Program · Playback · Visualise · System).

import { Fragment } from 'react'
import { LuKeyboard, LuPanelLeftClose, LuPanelLeftOpen } from 'react-icons/lu'
import { IconButton, Tooltip, cn } from '@renderer/components/ui'
import { useUiStore, type ViewTab } from '@renderer/stores/ui-store'
import { WORKSPACE_TABS } from './workspace-tabs'

/** Legacy tab ids that open another view */
const TAB_ALIASES: Partial<Record<ViewTab, ViewTab>> = { faders: 'fixtures' }

export function NavRail() {
  const activeTab = useUiStore((s) => s.activeTab)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const current = TAB_ALIASES[activeTab] ?? activeTab

  return (
    <nav
      aria-label="Workspace"
      className="flex w-[68px] shrink-0 flex-col items-stretch border-r border-line bg-surface-1 [[data-density=touch]_&]:w-[84px]"
    >
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 py-2">
        {WORKSPACE_TABS.map((tab, i) => {
          const newGroup = i > 0 && WORKSPACE_TABS[i - 1].group !== tab.group
          const selected = current === tab.id
          const Icon = tab.icon
          return (
            <Fragment key={tab.id}>
              {newGroup && <div role="separator" className="mx-2 my-1.5 h-px bg-line-subtle" />}
              <Tooltip content={tab.title} shortcut={tab.shortcut} placement="right">
                <button
                  type="button"
                  data-tab={tab.id}
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => useUiStore.getState().setActiveTab(tab.id)}
                  className={cn(
                    'group relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-md px-1 py-1.5 transition-colors duration-fast',
                    '[[data-density=touch]_&]:min-h-[54px]',
                    selected ? 'bg-surface-3 text-fg-primary' : 'text-fg-tertiary hover:bg-surface-2 hover:text-fg-primary'
                  )}
                >
                  {selected && <span aria-hidden className="absolute -left-1.5 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" />}
                  <Icon size={20} aria-hidden className={cn('shrink-0', selected && 'text-accent-fg')} />
                  <span className="max-w-full truncate text-[11px] font-medium leading-none">{tab.label}</span>
                </button>
              </Tooltip>
            </Fragment>
          )
        })}
      </div>
      <div className="flex flex-col items-center gap-1 border-t border-line-subtle py-2">
        <IconButton
          icon={LuKeyboard}
          label="Keyboard shortcuts"
          shortcut="?"
          size="md"
          onClick={() => useUiStore.getState().setShortcutsOpen(true)}
          className="text-fg-tertiary"
        />
        <IconButton
          icon={sidebarOpen ? LuPanelLeftClose : LuPanelLeftOpen}
          label={sidebarOpen ? 'Hide fixture list' : 'Show fixture list'}
          size="md"
          active={sidebarOpen}
          tone="neutral"
          onClick={() => useUiStore.getState().toggleSidebar()}
          className={sidebarOpen ? undefined : 'text-fg-tertiary'}
        />
      </div>
    </nav>
  )
}
