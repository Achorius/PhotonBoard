import React, { useEffect, useState, useCallback } from 'react'
import { GrandMasterFader } from './components/GrandMasterFader'
import { MasterButtons } from './components/MasterButtons'
import { ExecutorGrid } from './components/ExecutorGrid'
import { GroupButtons } from './components/GroupButtons'
import { ClockDisplay } from './components/ClockDisplay'

declare global {
  interface Window {
    stageApi: {
      onStateSync: (callback: (state: StageState) => void) => void
      sendCommand: (command: { type: string; payload?: any }) => void
      close: () => void
    }
  }
}

export interface StageState {
  grandMaster: number
  blackout: boolean
  blinder: boolean
  strobe: boolean
  timelinePlaying: boolean
  showName: string
  cuelists: {
    id: string
    name: string
    isPlaying: boolean
    faderLevel: number
    currentCueIndex: number
    cueCount: number
  }[]
  groups: {
    id: string
    name: string
    color: string
    fixtureCount: number
  }[]
  selectedFixtureIds: string[]
  fixtureCount: number
}

const INITIAL_STATE: StageState = {
  grandMaster: 255,
  blackout: false,
  blinder: false,
  strobe: false,
  timelinePlaying: false,
  showName: 'PhotonBoard',
  cuelists: [],
  groups: [],
  selectedFixtureIds: [],
  fixtureCount: 0
}

export function StageApp() {
  const [state, setState] = useState<StageState>(INITIAL_STATE)

  const sendCommand = useCallback((type: string, payload?: any) => {
    window.stageApi.sendCommand({ type, payload })
  }, [])

  useEffect(() => {
    window.stageApi.onStateSync((newState) => {
      setState(newState)
    })
  }, [])

  return (
    <div className="flex h-screen w-screen bg-surface-0 overflow-hidden">
      {/* Left column: Grand Master + Master Buttons */}
      <div className="w-28 shrink-0 flex flex-col border-r-2 border-surface-3 bg-surface-1">
        {/* Show name & clock */}
        <ClockDisplay showName={state.showName} fixtureCount={state.fixtureCount} />

        {/* Grand Master */}
        <GrandMasterFader
          value={state.grandMaster}
          onChange={(v) => sendCommand('set-grand-master', v)}
        />

        {/* Master buttons */}
        <MasterButtons
          blackout={state.blackout}
          blinder={state.blinder}
          strobe={state.strobe}
          timelinePlaying={state.timelinePlaying}
          onBlackout={() => sendCommand('toggle-blackout')}
          onBlinder={(active) => sendCommand('toggle-blinder', active)}
          onStrobe={(active) => sendCommand('toggle-strobe', active)}
          onLive={() => sendCommand('toggle-timeline')}
          onClear={() => sendCommand('clear-programmer')}
        />
      </div>

      {/* Center: Executor Grid */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Groups bar */}
        <GroupButtons
          groups={state.groups}
          selectedFixtureIds={state.selectedFixtureIds}
          onSelectGroup={(id) => sendCommand('select-group', id)}
          onSelectAll={() => sendCommand('select-all')}
          onClearSelection={() => sendCommand('clear-selection')}
        />

        {/* Executor grid */}
        <ExecutorGrid
          cuelists={state.cuelists}
          onGo={(id) => sendCommand('go-cuelist', id)}
          onStop={(id) => sendCommand('stop-cuelist', id)}
          onFader={(id, level) => sendCommand('set-cuelist-fader', { id, level })}
        />
      </div>

      {/* ESC to close overlay hint */}
      <div className="fixed bottom-3 right-3 text-[10px] text-gray-700 pointer-events-none">
        ESC = close
      </div>
    </div>
  )
}
