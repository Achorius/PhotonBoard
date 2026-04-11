import React, { useState, useRef, useCallback } from 'react'

interface OFLSearchResult {
  name: string
  manufacturer: string
  manufacturerKey: string
  fixtureKey: string
  categories: string[]
}

interface OFLSearchPanelProps {
  onFixtureDownloaded: () => void
}

export function OFLSearchPanel({ onFixtureDownloaded }: OFLSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<OFLSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null) // fixtureKey being downloaded
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setError(null); return }
    setSearching(true)
    setError(null)
    try {
      const res = await window.photonboard.fixtures.oflSearch(q)
      setResults(res || [])
    } catch (e: any) {
      setError(e.message || 'Search failed')
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  const handleInput = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(value), 400)
  }

  const handleDownload = async (result: OFLSearchResult) => {
    const key = `${result.manufacturerKey}/${result.fixtureKey}`
    setDownloading(key)
    try {
      await window.photonboard.fixtures.oflDownload(result.manufacturerKey, result.fixtureKey)
      setDownloaded(prev => new Set(prev).add(key))
      onFixtureDownloaded()
    } catch (e: any) {
      setError(`Download failed: ${e.message}`)
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2">
        <input
          className="input w-full"
          placeholder="Search 20,000+ fixtures online..."
          value={query}
          onChange={e => handleInput(e.target.value)}
          autoFocus
        />
      </div>

      <div className="flex-1 overflow-auto">
        {/* Empty state */}
        {!query && !searching && results.length === 0 && (
          <div className="text-center py-8 px-4">
            <div className="text-gray-500 text-xs mb-2">Open Fixture Library</div>
            <div className="text-gray-600 text-[10px]">
              Search by manufacturer, model name, or category.<br />
              Results are downloaded and added to your local library.
            </div>
          </div>
        )}

        {/* Searching indicator */}
        {searching && (
          <div className="text-center py-4 text-gray-500 text-xs">
            Searching...
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-2 mb-2 px-2 py-1.5 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-[10px]">
            {error}
          </div>
        )}

        {/* Results count */}
        {!searching && results.length > 0 && (
          <div className="px-3 py-1 text-[9px] text-gray-500 uppercase tracking-wide bg-surface-0 sticky top-0">
            {results.length} result{results.length !== 1 ? 's' : ''} from Open Fixture Library
          </div>
        )}

        {/* No results */}
        {!searching && query && results.length === 0 && !error && (
          <div className="text-center py-4 text-gray-600 text-xs">
            No fixtures found for "{query}"
          </div>
        )}

        {/* Results */}
        {results.map(r => {
          const key = `${r.manufacturerKey}/${r.fixtureKey}`
          const isDownloading = downloading === key
          const isDownloaded = downloaded.has(key)
          return (
            <div
              key={key}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-2 border-b border-surface-3/50"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-200 truncate">{r.name}</div>
                <div className="text-[10px] text-gray-500 truncate">{r.manufacturer}</div>
              </div>
              {isDownloaded ? (
                <span className="text-[10px] text-green-400 shrink-0">Added</span>
              ) : (
                <button
                  className="px-2 py-0.5 rounded text-[10px] bg-accent/20 text-accent hover:bg-accent/30 shrink-0 disabled:opacity-40"
                  disabled={isDownloading}
                  onClick={() => handleDownload(r)}
                >
                  {isDownloading ? '...' : 'Add'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
