import { Chord } from 'chordsheetjs'
import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  buildSongView,
  loadSongLibrary,
  type SongEntry,
  type SongView,
} from './lib/songbook'

const MIN_FONT_SIZE = 14
const MAX_FONT_SIZE = 28
const DEFAULT_FONT_SIZE = 18

interface LineToken {
  text: string
  isChord: boolean
}

interface RouteSong {
  mode: 'song'
  folder: string
  slug: string
}

interface RouteFolder {
  mode: 'folder'
  folder: string
}

interface RouteHome {
  mode: 'home'
}

type AppRoute = RouteHome | RouteFolder | RouteSong

interface SongRouteEntry {
  song: SongEntry
  folder: string
  slug: string
}

function tokenizeCustomLine(line: string): LineToken[] {
  return line
    .split(/(\s+|\||\(|\)|\[|\]|\{|\}|,|\.|:|;|\+|-|\\|\/)/g)
    .filter(Boolean)
    .map((part) => ({
      text: part,
      isChord: Chord.parse(part) !== null,
    }))
}

function fileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

function slugify(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9\u0590-\u05ff]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function songFolder(songPath: string): string {
  const normalized = songPath.replace(/^chords\//, '')
  const segments = normalized.split('/')
  if (segments.length <= 1) {
    return ''
  }

  return segments.slice(0, -1).join('/')
}

function parsePathRoute(pathname: string): AppRoute {
  const parts = pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))

  if (!parts.length) {
    return { mode: 'home' }
  }

  if (parts.length === 1) {
    return { mode: 'folder', folder: parts[0] }
  }

  return {
    mode: 'song',
    folder: parts.slice(0, -1).join('/'),
    slug: parts[parts.length - 1],
  }
}

function routePath(route: AppRoute): string {
  if (route.mode === 'home') {
    return '/'
  }

  if (route.mode === 'folder') {
    const folderPath = route.folder
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    return folderPath ? `/${folderPath}/` : '/'
  }

  const folderPath = route.folder
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  if (!folderPath) {
    return `/${encodeURIComponent(route.slug)}/`
  }

  return `/${folderPath}/${encodeURIComponent(route.slug)}/`
}

function navigate(route: AppRoute): void {
  const path = routePath(route)
  if (window.location.pathname === path) {
    return
  }

  window.history.pushState({ path }, '', `${path}${window.location.hash}`)
}

function App() {
  const [songs, setSongs] = useState<SongEntry[]>([])
  const [query, setQuery] = useState('')
  const [transpose, setTranspose] = useState(0)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<AppRoute>(() => parsePathRoute(window.location.pathname))

  useEffect(() => {
    let active = true

    async function initialize() {
      try {
        const library = await loadSongLibrary()

        if (!active) {
          return
        }

        setSongs(library)
        setStatus(library.some((song) => song.source === 'sample') ? 'fallback' : 'ready')
      } catch (loadError) {
        if (!active) {
          return
        }

        setError(loadError instanceof Error ? loadError.message : 'Failed to load library')
        setStatus('fallback')
      }
    }

    void initialize()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    function onPopState() {
      setRoute(parsePathRoute(window.location.pathname))
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  const routeSongs = useMemo(() => {
    const folderSlugCount = new Map<string, number>()

    return songs
      .map((song) => {
        const folder = songFolder(song.path)
        const baseSlug = slugify(fileStem(song.name) || song.title || 'song')
        const key = `${folder}::${baseSlug}`
        const count = folderSlugCount.get(key) ?? 0
        folderSlugCount.set(key, count + 1)
        const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`

        return { song, folder, slug }
      })
      .sort((left, right) => left.song.path.localeCompare(right.song.path))
  }, [songs])

  const folders = useMemo(() => {
    const set = new Set(routeSongs.map((entry) => entry.folder).filter(Boolean))
    return Array.from(set).sort((left, right) => left.localeCompare(right))
  }, [routeSongs])

  const rootSongs = useMemo(() => {
    return routeSongs
      .filter((entry) => entry.folder === '')
      .filter((entry) => {
        if (!query.trim()) {
          return true
        }

        const haystack = `${entry.song.title} ${entry.song.artist ?? ''} ${entry.song.path}`.toLowerCase()
        return haystack.includes(query.trim().toLowerCase())
      })
  }, [query, routeSongs])

  const filteredFolders = useMemo(() => {
    if (!query.trim()) {
      return folders
    }

    const normalized = query.trim().toLowerCase()
    return folders.filter((folder) => {
      if (folder.toLowerCase().includes(normalized)) {
        return true
      }

      return routeSongs.some((entry) => {
        if (entry.folder !== folder) {
          return false
        }

        const haystack = `${entry.song.title} ${entry.song.artist ?? ''} ${entry.song.path}`.toLowerCase()
        return haystack.includes(normalized)
      })
    })
  }, [folders, query, routeSongs])

  const songsInRouteFolder = useMemo(() => {
    if (route.mode === 'home') {
      return [] as SongRouteEntry[]
    }

    return routeSongs
      .filter((entry) => entry.folder === route.folder)
      .filter((entry) => {
        if (!query.trim()) {
          return true
        }

        const haystack = `${entry.song.title} ${entry.song.artist ?? ''} ${entry.song.path}`.toLowerCase()
        return haystack.includes(query.trim().toLowerCase())
      })
  }, [query, route, routeSongs])

  const selectedSongEntry = useMemo(() => {
    if (route.mode !== 'song') {
      return null
    }

    return routeSongs.find((entry) => entry.folder === route.folder && entry.slug === route.slug) ?? null
  }, [route, routeSongs])

  useEffect(() => {
    if (route.mode !== 'song' || selectedSongEntry) {
      return
    }

    const fallback = routeSongs.find((entry) => entry.folder === route.folder)
    if (fallback) {
      const nextRoute: AppRoute = { mode: 'song', folder: fallback.folder, slug: fallback.slug }
      setRoute(nextRoute)
      navigate(nextRoute)
      return
    }

    const folderExists = routeSongs.some((entry) => entry.folder === route.folder)
    const nextRoute: AppRoute = folderExists ? { mode: 'folder', folder: route.folder } : { mode: 'home' }
    setRoute(nextRoute)
    navigate(nextRoute)
  }, [route, routeSongs, selectedSongEntry])

  useEffect(() => {
    if (route.mode !== 'folder') {
      return
    }

    const folderExists = routeSongs.some((entry) => entry.folder === route.folder)
    if (folderExists) {
      return
    }

    const rootSongMatch = routeSongs.find((entry) => entry.folder === '' && entry.slug === route.folder)
    if (!rootSongMatch) {
      return
    }

    const nextRoute: AppRoute = { mode: 'song', folder: '', slug: rootSongMatch.slug }
    setRoute(nextRoute)
    navigate(nextRoute)
  }, [route, routeSongs])

  const view: SongView | null = selectedSongEntry ? buildSongView(selectedSongEntry.song, transpose) : null

  return (
    <div className="app-shell" style={{ ['--song-font-size' as string]: `${fontSize}px` }}>
      {route.mode === 'home' ? (
        <main className="list-screen">
          <div className="search-wrap">
            <input
              type="search"
              placeholder="Search folders or songs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search folders or songs"
            />
          </div>
          <h1 className="page-title">Folders</h1>
          {status === 'loading' ? <p className="hint">Loading folders…</p> : null}
          {status === 'fallback' ? <p className="hint">Showing local songs.</p> : null}
          {error ? <p className="error-banner">{error}</p> : null}

          <div className="folder-list">
            {filteredFolders.map((folder) => (
              <button
                key={folder}
                type="button"
                className="folder-card"
                onClick={() => {
                  const nextRoute: AppRoute = { mode: 'folder', folder }
                  setRoute(nextRoute)
                  navigate(nextRoute)
                }}
              >
                {folder}
              </button>
            ))}
            {!filteredFolders.length && status !== 'loading' ? <p className="hint">No folders found.</p> : null}
          </div>

          <div className="song-list">
            {rootSongs.map((entry) => (
              <button
                key={entry.song.path}
                type="button"
                className="song-card"
                onClick={() => {
                  const nextRoute: AppRoute = {
                    mode: 'song',
                    folder: '',
                    slug: entry.slug,
                  }
                  setRoute(nextRoute)
                  navigate(nextRoute)
                }}
              >
                <strong>{entry.song.title}</strong>
                {entry.song.artist ? <span>{entry.song.artist}</span> : null}
              </button>
            ))}
            {!rootSongs.length && status !== 'loading' ? <p className="hint">No songs in root.</p> : null}
          </div>
        </main>
      ) : route.mode === 'folder' ? (
        <main className="list-screen">
          <div className="search-wrap">
            <input
              type="search"
              placeholder="Search songs in folder"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search songs"
            />
          </div>

          <div className="header-row">
            <button
              type="button"
              onClick={() => {
                const nextRoute: AppRoute = { mode: 'home' }
                setRoute(nextRoute)
                navigate(nextRoute)
              }}
            >
              Folders
            </button>
            <h1 className="page-title">{route.folder}</h1>
          </div>

          <div className="song-list">
            {songsInRouteFolder.map((entry) => (
              <button
                key={entry.song.path}
                type="button"
                className="song-card"
                onClick={() => {
                  const nextRoute: AppRoute = {
                    mode: 'song',
                    folder: entry.folder,
                    slug: entry.slug,
                  }
                  setRoute(nextRoute)
                  navigate(nextRoute)
                }}
              >
                <strong>{entry.song.title}</strong>
                {entry.song.artist ? <span>{entry.song.artist}</span> : null}
              </button>
            ))}

            {!songsInRouteFolder.length ? <p className="hint">No songs in this folder.</p> : null}
          </div>
        </main>
      ) : (
        <main className="song-screen">
          <div className="song-toolbar">
            <button
              type="button"
              onClick={() => {
                const nextRoute: AppRoute = { mode: 'folder', folder: route.folder }
                setRoute(nextRoute)
                navigate(nextRoute)
              }}
            >
              {route.folder || 'Folders'}
            </button>

            <div className="controls" aria-label="Song controls">
              <div className="control-block">
                <div className="button-row">
                  <button type="button" onClick={() => setTranspose(0)}>
                    {transpose > 0 ? `+${transpose}` : transpose}
                  </button>
                  <button type="button" onClick={() => setTranspose((value) => value + 1)}>
                    +
                  </button>
                  <button type="button" onClick={() => setTranspose((value) => value - 1)}>
                    -
                  </button>
                </div>
              </div>

              <div className="control-block">
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() => setFontSize((size) => Math.max(MIN_FONT_SIZE, size - 1))}
                  >
                    A-
                  </button>
                  <button
                    type="button"
                    onClick={() => setFontSize((size) => Math.min(MAX_FONT_SIZE, size + 1))}
                  >
                    A+
                  </button>
                </div>
              </div>
            </div>
          </div>

          {view ? (
            <article className="song-view" dir={view.format === 'chords' ? 'ltr' : view.rtl ? 'rtl' : 'ltr'}>
              <div className="song-top-meta">
                {view.capo ? <p className="capo-line">Capo {view.capo}</p> : null}
                {view.fingerings?.length ? (
                  <div className="fingering-list simple">
                    {view.fingerings.map((definition) => (
                      <div
                        key={`${definition.chord}-${definition.fingering}`}
                        className="fingering-chip simple"
                      >
                        <span>{definition.chord}</span>
                        <span>{definition.fingering}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="song-header">
                <h1>{view.title}</h1>
                {view.artist ? <p>{view.artist}</p> : null}
              </div>

              {view.choproBlocks?.length ? (
                <div className="chopro-sheet" dir={view.rtl ? 'rtl' : 'ltr'}>
                  {view.choproBlocks.map((block, blockIndex) => {
                    if (block.type === 'section' && block.text) {
                      return (
                        <h3 key={`chopro-block-${blockIndex}`} className="section">
                          {block.text}
                        </h3>
                      )
                    }

                    if (block.type === 'spacer') {
                      return <div key={`chopro-block-${blockIndex}`} className="spacer" />
                    }

                    const tokens = block.tokens ?? []

                    if (!tokens.length) {
                      return (
                        <div key={`chopro-block-${blockIndex}`} className="line-block empty" dir={view.rtl ? 'rtl' : 'ltr'}>
                          <div className="phrase-row" />
                        </div>
                      )
                    }

                    return (
                      <div key={`chopro-block-${blockIndex}`} className="line-block" dir={view.rtl ? 'rtl' : 'ltr'}>
                        <div className={block.hasLyrics ? 'phrase-row' : 'phrase-row no-lyrics'}>
                          {tokens.map((token, tokenIndex) => (
                            <div key={`chopro-token-${blockIndex}-${tokenIndex}`} className="phrase-block">
                              {token.chord ? (
                                <div className="phrase-chord">{token.chord}</div>
                              ) : (
                                <div className="phrase-chord empty"></div>
                              )}

                              {token.lyric ? (
                                <div className="phrase-lyric">{token.lyric}</div>
                              ) : (
                                <div className="phrase-lyric empty"></div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}

              {view.sections ? (
                <div className="custom-sheet custom-sheet-ltr">
                  {view.sections.map((section) => (
                    <section key={section.label} className="custom-section">
                      <h3>{section.label}</h3>
                      <div className="custom-lines">
                        {section.lines.map((line, index) => (
                          <p key={`${section.label}-${index}`} className="custom-line">
                            {tokenizeCustomLine(line).map((token, tokenIndex) => (
                              <span
                                key={`${section.label}-${index}-${tokenIndex}`}
                                className={token.isChord ? 'token-chord' : 'token-muted'}
                              >
                                {token.text}
                              </span>
                            ))}
                          </p>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </article>
          ) : (
            <p className="hint">Song not found in this folder.</p>
          )}
        </main>
      )}
    </div>
  )
}

export default App