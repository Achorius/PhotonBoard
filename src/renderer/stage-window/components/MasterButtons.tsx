import React from 'react'

interface Props {
  blackout: boolean
  blinder: boolean
  strobe: boolean
  timelinePlaying: boolean
  onBlackout: () => void
  onBlinder: (active: boolean) => void
  onStrobe: (active: boolean) => void
  onLive: () => void
  onClear: () => void
}

export function MasterButtons({ blackout, blinder, strobe, timelinePlaying, onBlackout, onBlinder, onStrobe, onLive, onClear }: Props) {
  return (
    <div className="shrink-0 flex flex-col gap-2 p-2 border-t border-surface-3">
      {/* Live / Timeline */}
      <button
        className={`w-full py-3 rounded-lg text-sm font-black uppercase tracking-wide transition-all active:scale-95 ${
          timelinePlaying
            ? 'bg-green-500 text-black shadow-[0_0_24px_rgba(34,197,94,0.5)] animate-pulse'
            : 'bg-green-900/40 text-green-400 border border-green-700/50'
        }`}
        onClick={onLive}
      >
        LIVE
      </button>

      {/* Clear */}
      <button
        className="w-full py-2.5 rounded-lg text-xs font-bold uppercase bg-surface-3 text-gray-400 active:bg-orange-700 active:text-white active:scale-95 transition-all"
        onClick={onClear}
      >
        CLEAR
      </button>

      {/* Blinder — hold */}
      <button
        className={`w-full py-3 rounded-lg text-sm font-black uppercase tracking-wide transition-all active:scale-95 ${
          blinder
            ? 'bg-yellow-300 text-black shadow-[0_0_30px_rgba(253,224,71,0.6)]'
            : 'bg-yellow-900/30 text-yellow-500 border border-yellow-700/40'
        }`}
        onPointerDown={() => onBlinder(true)}
        onPointerUp={() => onBlinder(false)}
        onPointerLeave={() => blinder && onBlinder(false)}
      >
        BLIND
      </button>

      {/* Strobe — hold */}
      <button
        className={`w-full py-3 rounded-lg text-sm font-black uppercase tracking-wide transition-all active:scale-95 ${
          strobe
            ? 'bg-cyan-300 text-black shadow-[0_0_24px_rgba(34,211,238,0.5)] animate-pulse'
            : 'bg-cyan-900/30 text-cyan-500 border border-cyan-700/40'
        }`}
        onPointerDown={() => onStrobe(true)}
        onPointerUp={() => onStrobe(false)}
        onPointerLeave={() => strobe && onStrobe(false)}
      >
        STROBE
      </button>

      {/* Blackout — toggle */}
      <button
        className={`w-full py-4 rounded-lg text-sm font-black uppercase tracking-wide transition-all active:scale-95 ${
          blackout
            ? 'bg-red-600 text-white shadow-[0_0_30px_rgba(220,38,38,0.6)] animate-pulse'
            : 'bg-red-900/30 text-red-400 border border-red-700/40'
        }`}
        onClick={onBlackout}
      >
        BLACK<br/>OUT
      </button>
    </div>
  )
}
