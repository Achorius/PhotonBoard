import React, { useState, useEffect } from 'react'

interface Props {
  showName: string
  fixtureCount: number
}

export function ClockDisplay({ showName, fixtureCount }: Props) {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const hh = time.getHours().toString().padStart(2, '0')
  const mm = time.getMinutes().toString().padStart(2, '0')
  const ss = time.getSeconds().toString().padStart(2, '0')

  return (
    <div className="shrink-0 px-2 py-3 border-b border-surface-3 text-center">
      {/* Clock */}
      <div className="text-xl font-mono font-black text-gray-300 tracking-wider">
        {hh}:{mm}<span className="text-gray-600 text-sm">:{ss}</span>
      </div>

      {/* Show name */}
      <div className="text-[9px] text-accent font-semibold truncate mt-1.5" title={showName}>
        {showName}
      </div>

      {/* Fixture count */}
      <div className="text-[8px] text-gray-600 mt-0.5">
        {fixtureCount} fix
      </div>
    </div>
  )
}
