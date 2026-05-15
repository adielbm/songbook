'use client'

import { useTheme } from 'next-themes'
import { useEffect, useMemo, useState } from 'react'
import {
  AArrowDown,
  AArrowUp,
  ChevronLeft,
  FolderOpen,
  MoonStar,
  Music2,
  RefreshCw,
  Minus,
  Plus,
  RotateCcw,
  Settings2,
  SunMedium,
  UploadCloud,
  X,
  Home,
  Users,
} from 'lucide-react'
import { pullSongsFromGithub } from '@/lib/github'
import { buildSongView, fileStem, normalizeChordSymbol, normalizeChordSymbolForKey, type SongEntry, type SongView } from '@/lib/songbook-core'
import { ChordTooltip } from '@/components/chord-tooltip'
import { sampleSongs } from '@/lib/samples'
import {
  clearSettings,
  loadCachedSongs,
  loadCachedSongsWithShas,
  loadSettings,
  loadSyncMeta,
  replaceCachedSongs,
  repoKey,
  saveSettings,
  saveSyncMeta,
  type RepoSettings,
} from '@/lib/storage'
import { dir } from 'console'

const MIN_FONT_SIZE = 14
const MAX_FONT_SIZE = 28
const DEFAULT_FONT_SIZE = 18
const BASE_PATH = '/songbook'

type LineToken = {
  text: string
  isChord: boolean
}

type InlineChordToken = {
  chord?: string
  lyric: string
}

type RouteSong = {
  mode: 'song'
  folder: string
  slug: string
}

type RouteFolder = {
  mode: 'folder'
  folder: string
}

type RouteHome = {
  mode: 'home'
}

type RouteSettings = {
  mode: 'settings'
}

type RouteArtists = {
  mode: 'artists'
}

type RouteArtist = {
  mode: 'artist'
  artist: string
}

type AppRoute = RouteHome | RouteFolder | RouteSong | RouteSettings | RouteArtists | RouteArtist

type SongRouteEntry = {
  song: SongEntry
  folder: string
  slug: string
}

type LibraryRow =
  | {
    kind: 'folder'
    folder: string
  }
  | {
    kind: 'song'
    folder: string
    slug: string
    song: SongEntry
  }

function tokenizeCustomLine(line: string, tonic: string | null = null, isMinor: boolean = false): LineToken[] {
  return line
    .split(/(\s+|\||\(|\)|\[|\]|\{|\}|,|\.|:|;|\+|-|\\|\/)/g)
    .filter(Boolean)
    .map((part) => {
      const isChord = /^[A-G](?:#|b)?(?:m|maj|min|sus|dim|aug|add|no|M|[0-9]|[#b]|\(|\)|\+|-)*(?:\/[A-G](?:#|b)?)?$/i.test(part)
      return {
        text: isChord ? normalizeChordSymbolForKey(part, tonic, isMinor) : part,
        isChord,
      }
    })
}

function parseInlineChordLine(line: string, tonic: string | null = null, isMinor: boolean = false): InlineChordToken[] {
  const pattern = /\[([^\]]+)\]/g
  let cursor = 0
  let lyrics = ''
  const chords: { chord: string; pos: number }[] = []

  for (const match of line.matchAll(pattern)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    const before = line.slice(cursor, start)

    if (before) {
      lyrics += before
    }

    const chord = normalizeChordSymbolForKey((match[1] ?? '').trim(), tonic, isMinor)
    if (chord) {
      chords.push({ chord, pos: lyrics.length })
    }

    cursor = end
  }

  const tail = line.slice(cursor)
  if (tail) {
    lyrics += tail
  }

  if (!chords.length) {
    return []
  }

  const tokens: InlineChordToken[] = []

  for (let index = 0; index < chords.length; index += 1) {
    const current = chords[index]
    const next = chords[index + 1]

    if (index === 0) {
      const leading = lyrics.slice(0, current.pos)
      if (leading.trim()) {
        tokens.push({ lyric: leading })
      }
    }

    tokens.push({
      chord: current.chord,
      lyric: lyrics.slice(current.pos, next ? next.pos : lyrics.length),
    })
  }

  return tokens
}

function textDirection(value: string): 'rtl' | 'ltr' {
  return /[\u0590-\u05FF]/.test(value) ? 'rtl' : 'ltr'
}

function transposeFromCapo(capo: string | null): number {
  if (!capo) {
    return 0
  }

  const capoMatch = capo.match(/-?\d+/)
  if (!capoMatch) {
    return 0
  }

  const capoValue = Number.parseInt(capoMatch[0], 10)
  if (Number.isNaN(capoValue)) {
    return 0
  }

  return -capoValue
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

function folderName(folderPath: string): string {
  const segments = folderPath.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? 'Root'
}

function immediateChildFolderPath(parentFolder: string, folderPath: string): string | null {
  if (folderPath === parentFolder) {
    return null
  }

  if (!parentFolder) {
    const [child] = folderPath.split('/').filter(Boolean)
    return child ?? null
  }

  const prefix = `${parentFolder}/`
  if (!folderPath.startsWith(prefix)) {
    return null
  }

  const remainder = folderPath.slice(prefix.length)
  const [child] = remainder.split('/').filter(Boolean)

  return child ? `${parentFolder}/${child}` : null
}

function songMatchesQuery(entry: SongRouteEntry, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true
  }

  const artistsStr = entry.song.artists.join(' ')
  const haystack = `${entry.song.title} ${artistsStr} ${entry.song.path}`.toLowerCase()
  return haystack.includes(normalizedQuery)
}

function songHasArtist(artists: string[], artist: string): boolean {
  const needle = artist.trim()
  if (!needle) {
    return false
  }

  return artists.some((value) => value.trim() === needle)
}

function folderMatchesQuery(folderPath: string, normalizedQuery: string, songs: SongRouteEntry[]): boolean {
  if (!normalizedQuery) {
    return true
  }

  if (folderPath.toLowerCase().includes(normalizedQuery)) {
    return true
  }

  const prefix = `${folderPath}/`

  return songs.some((entry) => {
    if (!entry.folder.startsWith(prefix)) {
      return false
    }

    return songMatchesQuery(entry, normalizedQuery)
  })
}

function parsePathRoute(): AppRoute {
  const pathname = window.location.pathname
  const cleaned = pathname === BASE_PATH ? '' : pathname.startsWith(`${BASE_PATH}/`) ? pathname.slice(BASE_PATH.length + 1) : pathname.replace(/^\//, '')
  const parts = cleaned ? cleaned.split('/').filter(Boolean).map((part) => decodeURIComponent(part)) : []

  if (!parts.length) {
    return { mode: 'home' }
  }

  if (parts[0] === 'settings') {
    return { mode: 'settings' }
  }

  if (parts[0] === 'folder') {
    return {
      mode: 'folder',
      folder: parts.slice(1).join('/'),
    }
  }

  if (parts[0] === 'artists') {
    return { mode: 'artists' }
  }

  if (parts[0] === 'artist') {
    return {
      mode: 'artist',
      artist: parts.slice(1).join('/'),
    }
  }

  if (parts[0] === 'song') {
    return {
      mode: 'song',
      folder: parts.slice(1, -1).join('/'),
      slug: parts[parts.length - 1] ?? '',
    }
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
    return `${BASE_PATH}/`
  }

  if (route.mode === 'settings') {
    return `${BASE_PATH}/settings/`
  }

  if (route.mode === 'artists') {
    return `${BASE_PATH}/artists/`
  }

  if (route.mode === 'artist') {
    return `${BASE_PATH}/artist/${encodeURIComponent(route.artist)}/`
  }

  if (route.mode === 'folder') {
    const folderPath = route.folder
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/')

    return folderPath ? `${BASE_PATH}/folder/${folderPath}/` : `${BASE_PATH}/folder/`
  }

  const folderPath = route.folder
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return folderPath ? `${BASE_PATH}/song/${folderPath}/${encodeURIComponent(route.slug)}/` : `${BASE_PATH}/song/${encodeURIComponent(route.slug)}/`
}

function shouldHandleLinkClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function navigate(route: AppRoute): void {
  const nextPath = routePath(route)

  if (window.location.pathname === nextPath) {
    return
  }

  window.history.pushState({}, '', nextPath)
}

function formatSyncDate(timestamp: number | null): string {
  if (!timestamp) {
    return 'Never synced'
  }

  return new Date(timestamp).toLocaleString()
}

function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <button aria-label="Toggle theme" disabled className="btn-outline btn-sm">
        <SunMedium size={16} />
      </button>
    )
  }

  const current = resolvedTheme ?? theme
  const isDark = current === 'dark'

  return (
    <button
      aria-label="Toggle theme"
      className="btn-outline btn-sm"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <MoonStar size={16} /> : <SunMedium size={16} />}
    </button>
  )
}

export function SongbookApp() {
  const [settings, setSettings] = useState<RepoSettings | null>(null)
  const [draft, setDraft] = useState<RepoSettings>({
    repository: '',
    branch: 'main',
    chordsPath: 'chords',
    token: '',
  })
  const [songs, setSongs] = useState<SongEntry[]>([])
  const [query, setQuery] = useState('')
  const [transpose, setTranspose] = useState(0)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<AppRoute>({ mode: 'home' })
  const [syncMetaText, setSyncMetaText] = useState('Never synced')
  const [pulling, setPulling] = useState(false)
  const [pullProgress, setPullProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })

  useEffect(() => {
    setRoute(parsePathRoute())
    const onPopState = () => setRoute(parsePathRoute())

    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  useEffect(() => {
    let active = true

    async function initialize() {
      const loaded = await loadSettings()

      if (!active) {
        return
      }

      if (!loaded) {
        setStatus('fallback')
        setSongs(sampleSongs)
        return
      }

      setSettings(loaded)
      setDraft(loaded)

      const key = repoKey(loaded)
      const cachedSongs = await loadCachedSongs(key)

      if (!active) {
        return
      }

      const syncMeta = await loadSyncMeta(key)
      setSyncMetaText(formatSyncDate(syncMeta.lastSyncedAt))

      if (cachedSongs.length > 0) {
        setSongs(cachedSongs)
        setStatus('ready')
      } else {
        setSongs(sampleSongs)
        setStatus('fallback')
      }
    }

    void initialize().catch((err: unknown) => {
      if (!active) {
        return
      }

      setError(err instanceof Error ? err.message : 'Failed to initialize app')
      setStatus('fallback')
      setSongs(sampleSongs)
    })

    return () => {
      active = false
    }
  }, [])

  async function handleSaveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!draft.repository.trim() || !draft.branch.trim() || !draft.token.trim()) {
      setError('All fields are required.')
      return
    }

    const next = {
      repository: draft.repository.trim(),
      branch: draft.branch.trim(),
      chordsPath: draft.chordsPath.trim().replace(/^\/+|\/+$/g, ''),
      token: draft.token.trim(),
    }

    await saveSettings(next)
    setSettings(next)
    setError(null)

    const key = repoKey(next)
    const cachedSongs = await loadCachedSongs(key)
    const syncMeta = await loadSyncMeta(key)
    setSyncMetaText(formatSyncDate(syncMeta.lastSyncedAt))

    if (cachedSongs.length) {
      setSongs(cachedSongs)
      setStatus('ready')
    } else {
      setSongs(sampleSongs)
      setStatus('fallback')
    }
  }

  async function handlePull() {
    if (!settings) {
      return
    }

    setPulling(true)
    setError(null)
    setPullProgress({ done: 0, total: 0 })

    const key = repoKey(settings)

    try {
      const cachedByPath = await loadCachedSongsWithShas(key)
      const pullResult = await pullSongsFromGithub(settings, cachedByPath, (done, total) => {
        setPullProgress({ done, total })
      })
      const pulledSongs = pullResult.songs

      if (!pulledSongs.length) {
        throw new Error('No .chopro or .chords files were found in the configured path.')
      }

      await replaceCachedSongs(key, pulledSongs, pullResult.pathShas)
      await saveSyncMeta({
        key,
        lastSyncedAt: Date.now(),
        lastError: null,
        count: pulledSongs.length,
      })

      setSongs(pulledSongs)
      setStatus('ready')
      setSyncMetaText(formatSyncDate(Date.now()))
    } catch (pullError) {
      const message = pullError instanceof Error ? pullError.message : 'Pull failed'
      setError(message)
      await saveSyncMeta({
        key,
        lastSyncedAt: null,
        lastError: message,
        count: 0,
      })
    } finally {
      setPulling(false)
    }
  }

  async function handleResetSettings() {
    await clearSettings()
    setSettings(null)
    setDraft({ repository: '', branch: 'main', chordsPath: 'chords', token: '' })
    setSongs(sampleSongs)
    setStatus('fallback')
    setSyncMetaText('Never synced')
    navigate({ mode: 'settings' })
  }

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

  const currentFolder = route.mode === 'folder' ? route.folder : ''
  const normalizedQuery = query.trim().toLowerCase()

  const visibleRows = useMemo<LibraryRow[]>(() => {
    if (normalizedQuery) {
      const folders = new Set<string>()

      for (const entry of routeSongs) {
        if (entry.folder && folderMatchesQuery(entry.folder, normalizedQuery, routeSongs)) {
          folders.add(entry.folder)
        }
      }

      const folderRows = Array.from(folders)
        .sort((left, right) => left.localeCompare(right))
        .map((folder) => ({ kind: 'folder' as const, folder }))

      const songRows = routeSongs
        .filter((entry) => songMatchesQuery(entry, normalizedQuery))
        .map((entry) => ({
          kind: 'song' as const,
          folder: entry.folder,
          slug: entry.slug,
          song: entry.song,
        }))

      return [...folderRows, ...songRows]
    }

    const childFolders = new Set<string>()

    for (const entry of routeSongs) {
      const childFolder = immediateChildFolderPath(currentFolder, entry.folder)
      if (!childFolder) {
        continue
      }

      if (folderMatchesQuery(childFolder, normalizedQuery, routeSongs)) {
        childFolders.add(childFolder)
      }
    }

    const folderRows = Array.from(childFolders)
      .sort((left, right) => left.localeCompare(right))
      .map((folder) => ({ kind: 'folder' as const, folder }))

    const songRows = routeSongs
      .filter((entry) => (normalizedQuery === '' ? entry.folder === currentFolder : true))
      .filter((entry) => songMatchesQuery(entry, normalizedQuery))
      .map((entry) => ({
        kind: 'song' as const,
        folder: entry.folder,
        slug: entry.slug,
        song: entry.song,
      }))

    return [...folderRows, ...songRows]
  }, [currentFolder, normalizedQuery, routeSongs])

  const visibleSongCount = visibleRows.filter((row) => row.kind === 'song').length

  const searchSongRows = useMemo(
    () =>
      routeSongs
        .filter((entry) => songMatchesQuery(entry, normalizedQuery))
        .map((entry) => ({
          folder: entry.folder,
          slug: entry.slug,
          song: entry.song,
        })),
    [normalizedQuery, routeSongs],
  )

  const artistList = useMemo(() => {
    const artists = new Set<string>()

    for (const entry of routeSongs) {
      for (const artist of entry.song.artists) {
        const trimmed = artist.trim()
        if (trimmed) {
          artists.add(trimmed)
        }
      }
    }

    return Array.from(artists).sort((left, right) => left.localeCompare(right))
  }, [routeSongs])

  const visibleArtists = useMemo(() => {
    if (!normalizedQuery) {
      return artistList
    }

    return artistList.filter((artist) => {
      if (artist.toLowerCase().includes(normalizedQuery)) {
        return true
      }

      return routeSongs.some((entry) => {
        if (!songHasArtist(entry.song.artists, artist)) {
          return false
        }

        return songMatchesQuery(entry, normalizedQuery)
      })
    })
  }, [artistList, normalizedQuery, routeSongs])

  const artistSongs = useMemo(() => {
    if (route.mode !== 'artist') {
      return []
    }

    const currentArtist = route.artist.trim()

    return routeSongs
      .filter((entry) => songMatchesQuery(entry, normalizedQuery))
      .filter((entry) => (normalizedQuery ? true : songHasArtist(entry.song.artists, currentArtist)))
      .map((entry) => ({
        folder: entry.folder,
        slug: entry.slug,
        song: entry.song,
      }))
  }, [normalizedQuery, route, routeSongs])

  const selectedSongEntry = useMemo(() => {
    if (route.mode !== 'song') {
      return null
    }

    return routeSongs.find((entry) => entry.folder === route.folder && entry.slug === route.slug) ?? null
  }, [route, routeSongs])

  useEffect(() => {
    if (status !== 'ready' && status !== 'fallback') {
      return
    }

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
  }, [route, routeSongs, selectedSongEntry, status])

  useEffect(() => {
    if (status !== 'ready' && status !== 'fallback') {
      return
    }

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
  }, [route, routeSongs, status])

  useEffect(() => {
    if (!selectedSongEntry) {
      return
    }

    const selectedSongView = buildSongView(selectedSongEntry.song, 0)
    setTranspose(transposeFromCapo(selectedSongView.capo))
  }, [selectedSongEntry?.song.path])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [route])

  function openRoute(nextRoute: AppRoute, options?: { clearQuery?: boolean }) {
    if (options?.clearQuery ?? true) {
      setQuery('')
    }

    setRoute(nextRoute)
    navigate(nextRoute)
  }

  function openSongRoute(folder: string, slug: string) {
    const nextRoute: AppRoute = { mode: 'song', folder, slug }
    openRoute(nextRoute)
  }

  const view: SongView | null = selectedSongEntry ? buildSongView(selectedSongEntry.song, transpose) : null
  const chordFingerings = useMemo(() => {
    const entries = view?.fingerings ?? []
    return new Map(
      entries.map((definition) => [
        normalizeChordSymbolForKey(definition.chord.trim(), view?.detectedTonic ?? null, view?.detectedIsMinor ?? false),
        definition.fingering,
      ]),
    )
  }, [view?.fingerings, view?.detectedTonic, view?.detectedIsMinor])

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-1.5 py-2 md:px-3" style={{ ['--song-font-size' as string]: `${fontSize}px` }} dir="rtl" lang="he">
      {/* <div className="text-center text-[7px] text-[var(--muted)]">{syncMetaText}</div> */}
      <header className="no-print z-20 mb-3 rounded-[1.2rem]">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              aria-label="Home"
              className="btn-outline btn-sm"
              onClick={() => {
                const nextRoute: AppRoute = { mode: 'home' }
                openRoute(nextRoute)
              }}
            >
              <Home size={16} />
            </button>
            <button
              aria-label="Artists"
              className="btn-outline btn-sm"
              onClick={() => {
                const nextRoute: AppRoute = { mode: 'artists' }
                openRoute(nextRoute)
              }}
            >
              <Users size={16} />
            </button>
          </div>

          <div className="flex items-center gap-1.5">

            {pulling ? (
              <div className="flex items-center gap-2 text-[0.65rem] text-[var(--muted)]">
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {pullProgress.done}/{pullProgress.total || '?'}
                </span>
              </div>
            ) : null}

            <button
              aria-label="Sync repository"
              className="btn-outline"
              onClick={() => {
                if (!settings) {
                  navigate({ mode: 'settings' })
                  return
                }
                void handlePull()
              }}
            >
              <span className="text-xs font-medium">{songs.length}</span>
            </button>
            <button
              aria-label="Open settings"
              className="btn-outline btn-sm"
              onClick={() => {
                const nextRoute: AppRoute = { mode: 'settings' }
                openRoute(nextRoute)
              }}
            >
              <Settings2 size={16} />
            </button>
            <ThemeToggle />
          </div>
        </div>

        <div className="grid gap-2">
          <div className="w-full">
            <div className="input-group">
              <input
                aria-label="Search songs or folders"
                placeholder="Search"
                type="text"
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value)
                }}
              />
              {query ? (
                <button
                  type="button"
                  className="text-xs text-[var(--muted)]"
                  onClick={() => {
                    setQuery('')
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {error ? <p className="no-print mb-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {status === 'fallback' ? (
        <p className="no-print mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">
          Using fallback songs until your private repo is connected and pulled.
        </p>
      ) : null}
      {route.mode === 'settings' ? (
        <main className="grid gap-3">
          <form className="grid gap-4" onSubmit={handleSaveSettings}>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[var(--text)]">Repository</label>
                <input
                  className="input-field"
                  placeholder="owner/repo"
                  value={draft.repository}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setDraft((state) => ({ ...state, repository: value }))
                  }}
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[var(--text)]">Branch</label>
                <input
                  className="input-field"
                  placeholder="main"
                  value={draft.branch}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setDraft((state) => ({ ...state, branch: value }))
                  }}
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[var(--text)]">Chord path (optional)</label>
                <input
                  className="input-field"
                  placeholder="leave blank for repo root"
                  value={draft.chordsPath}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setDraft((state) => ({ ...state, chordsPath: value }))
                  }}
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium text-[var(--text)]">GitHub token</label>
                <input
                  className="input-field"
                  placeholder="read-only token"
                  type="password"
                  value={draft.token}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setDraft((state) => ({ ...state, token: value }))
                  }}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button 
                type="submit" 
                disabled={pulling}
                className="btn-outline"
              >
                <UploadCloud size={16} />
                Save settings
              </button>
              <button
                type="button"
                disabled={!settings}
                aria-label="Sync repository"
                className="btn-outline"
                onClick={() => {
                  void handlePull()
                }}
              >
                <RefreshCw size={16} />
              </button>
              <button 
                type="button"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                onClick={() => void handleResetSettings()}
              >
                <X size={16} />
                Clear settings
              </button>
            </div>
          </form>
        </main>
      ) : route.mode === 'home' || route.mode === 'folder' ? (
        <main className="grid gap-3">
          {visibleRows.length ? (
            visibleRows.map((row) => {
              if (row.kind === 'folder') {
                const nextRoute: AppRoute = { mode: 'folder', folder: row.folder }

                return (
                  <a
                    key={row.folder}
                    className="library-row"
                    href={routePath(nextRoute)}
                    onClick={(event) => {
                      if (!shouldHandleLinkClick(event)) {
                        return
                      }

                      event.preventDefault()
                      openRoute(nextRoute)
                    }}
                  >
                    <span className="inline-flex items-center gap-2 text-[var(--muted)]">
                      <FolderOpen size={16} />
                    </span>
                    <span className="min-w-0 truncate font-medium">{folderName(row.folder)}</span>
                  </a>
                )
              }

              const nextRoute: AppRoute = { mode: 'song', folder: row.folder, slug: row.slug }

              return (
                <a
                  key={row.song.path}
                  className="library-row"
                  href={routePath(nextRoute)}
                  onClick={(event) => {
                    if (!shouldHandleLinkClick(event)) {
                      return
                    }

                    event.preventDefault()
                    openSongRoute(row.folder, row.slug)
                  }}
                >
                  <span className="inline-flex items-center gap-2 text-[var(--muted)]">
                    <Music2 size={16} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate">{row.song.title}</strong>
                    {row.song.artists.length > 0 ? <span className="block truncate text-xs text-[var(--muted)]">{row.song.artists.join(', ')}</span> : null}
                  </span>
                </a>
              )
            })
          ) : (
            <p className="px-3 py-4 text-sm text-[var(--muted)]">No folders or songs found.</p>
          )}
        </main>
      ) : route.mode === 'artists' ? (
        <main className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h4 className="m-0 text-xl font-semibold">Artists</h4>
            </div>
          </div>

          <hr />

          {visibleArtists.length ? (
            visibleArtists.map((artist) => {
              const nextRoute: AppRoute = { mode: 'artist', artist }

              return (
                <a
                  key={artist}
                  className="library-row"
                  href={routePath(nextRoute)}
                  onClick={(event) => {
                    if (!shouldHandleLinkClick(event)) {
                      return
                    }

                    event.preventDefault()
                    openRoute(nextRoute)
                  }}
                  dir={textDirection(artist)}
                >
                  <span className="inline-flex items-center gap-2 text-[var(--muted)]">
                    <Users size={16} />
                  </span>
                  <span className="min-w-0 truncate font-medium">{artist}</span>
                </a>
              )
            })
          ) : (
            <p className="px-3 py-4 text-sm text-[var(--muted)]">No artists found.</p>
          )}
        </main>
      ) : route.mode === 'artist' ? (
        <main className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                aria-label="Back to artists"
                className="btn-outline"
                onClick={() => {
                  const nextRoute: AppRoute = { mode: 'artists' }
                  openRoute(nextRoute)
                }}
              >
                <ChevronLeft size={16} />
              </button>
            </div>
          </div>

          <hr />

          {artistSongs.length ? (
            artistSongs.map((row) => {
              const nextRoute: AppRoute = { mode: 'song', folder: row.folder, slug: row.slug }

              return (
                <a
                  key={row.song.path}
                  className="library-row"
                  href={routePath(nextRoute)}
                  onClick={(event) => {
                    if (!shouldHandleLinkClick(event)) {
                      return
                    }

                    event.preventDefault()
                    openSongRoute(row.folder, row.slug)
                  }}
                >
                  <span className="inline-flex items-center gap-2 text-[var(--muted)]">
                    <Music2 size={16} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate">{row.song.title}</strong>
                    {row.song.artists.length > 0 ? (
                      <span className="block truncate text-xs text-[var(--muted)]" dir={textDirection(row.song.artists.join(' '))}>
                        {row.song.artists.join(', ')}
                      </span>
                    ) : null}
                  </span>
                </a>
              )
            })
          ) : (
            <p className="px-3 py-4 text-sm text-[var(--muted)]">{normalizedQuery ? 'No songs found for this search.' : 'No songs found for this artist.'}</p>
          )}
        </main>
      ) : (
        <main className="grid gap-3">
          {normalizedQuery ? (
            <section className="grid gap-2">
              {searchSongRows.length ? (
                searchSongRows.map((row) => {
                  const nextRoute: AppRoute = { mode: 'song', folder: row.folder, slug: row.slug }

                  return (
                    <a
                      key={row.song.path}
                      className="library-row"
                      href={routePath(nextRoute)}
                      onClick={(event) => {
                        if (!shouldHandleLinkClick(event)) {
                          return
                        }

                        event.preventDefault()
                        openRoute(nextRoute)
                      }}
                    >
                      <span className="inline-flex items-center gap-2 text-[var(--muted)]">
                        <Music2 size={16} />
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate">{row.song.title}</strong>
                        {row.song.artists.length > 0 ? <span className="block truncate text-xs text-[var(--muted)]">{row.song.artists.join(', ')}</span> : null}
                      </span>
                    </a>
                  )
                })
              ) : (
                <p className="px-3 py-4 text-sm text-[var(--muted)]">No songs found for this search.</p>
              )}
            </section>
          ) : null}

          {view ? (
            <article className="song-sheet rounded-xl py-3" dir={view.format === 'chords' ? 'ltr' : view.rtl ? 'rtl' : 'ltr'}>
              <div className="no-print flex flex-wrap items-center gap-1.5">
                <button aria-label="Transpose up" className="btn-outline" onClick={() => setTranspose((value) => value + 1)}>
                  <Plus size={16} />
                </button>
                <button aria-label="Reset transpose" className="btn-outline" onClick={() => setTranspose(0)}>
                  <span
                    className={[
                      'inline-flex items-center justify-center rounded-full font-semibold tabular-nums',
                      transpose === 0
                        ? 'text-[var(--muted)]'
                        : 'text-[var(--chord)]',
                    ].join(' ')}
                    aria-label={`Transpose ${transpose}`}
                  >
                    {transpose > 0 ? `+${transpose}` : transpose}
                  </span>
                </button>
                <button aria-label="Transpose down" className="btn-outline" onClick={() => setTranspose((value) => value - 1)}>
                  <Minus size={16} />
                </button>
                <div className="ml-auto flex items-center gap-1.5">
                  <button aria-label="Decrease text size" className="btn-outline" onClick={() => setFontSize((size) => Math.max(MIN_FONT_SIZE, size - 1))}>
                    <AArrowDown size={16} />
                  </button>
                  <button aria-label="Increase text size" className="btn-outline" onClick={() => setFontSize((size) => Math.min(MAX_FONT_SIZE, size + 1))}>
                    <AArrowUp size={16} />
                  </button>
                </div>
              </div>


              <div className="mb-3 grid gap-1">
                {view.fingerings?.length ? (
                  <div className="grid text-[var(--muted)] py-2 border-t border-b border-[var(--border)] my-3">
                    {view.fingerings.map((definition) => (
                      <div key={`${definition.chord}-${definition.fingering}`} className="inline-flex">
                        <span className="text-[var(--chord)] min-w-[60px]">{definition.chord}</span>
                        <span className="text-[var(--muted)]">{definition.fingering}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div style={{ direction: 'rtl' }} className="text-right song-title">
                <span className="m-0 pl-2 font-semibold">{view.title}</span>
                {view.artists.length > 0 ? (
                  <span className="m-0" dir={textDirection(view.artists.join(' '))}>
                    {view.artists.map((artist, index) => (
                      <span key={artist}>
                        <a
                          className="transition-colors hover:text-[var(--text)] text-sm"
                          href={routePath({ mode: 'artist', artist })}
                          onClick={(event) => {
                            if (!shouldHandleLinkClick(event)) {
                              return
                            }

                            event.preventDefault()
                            const nextRoute: AppRoute = { mode: 'artist', artist }
                            openRoute(nextRoute)
                          }}
                        >
                          {artist}
                        </a>
                        {index < view.artists.length - 1 && <span>, </span>}
                      </span>
                    ))}
                  </span>
                ) : null}
                {view.comment ? <p className="comments m-0 text-sm text-[var(--muted)]" dir={textDirection(view.comment)}>{view.comment}</p> : null}
              </div>

              {view.choproBlocks?.length ? (
                <div className="chopro-sheet" dir={view.rtl ? 'rtl' : 'ltr'}>
                  {view.choproBlocks.map((block, blockIndex) => {
                    if (block.type === 'section' && block.text) {
                      return (
                        <h3 key={`chopro-block-${blockIndex}`} className="section" dir={textDirection(block.text)}>
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
                                <ChordTooltip
                                  chord={token.chord}
                                  fingering={chordFingerings.get(token.chord.trim()) ?? null}
                                  as="div"
                                  className="phrase-chord-trigger"
                                  tonic={view?.detectedTonic ?? null}
                                  isMinor={view?.detectedIsMinor ?? false}
                                >
                                  <div className="phrase-chord">{token.chord}</div>
                                </ChordTooltip>
                              ) : (
                                <div className="phrase-chord empty">.</div>
                              )}

                              {token.lyric?.trim() ? (
                                <div className="phrase-lyric">{token.lyric}</div>
                              ) : (
                                <div className="phrase-lyric empty">.</div>
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
                <div className="grid gap-1" dir="ltr">
                  {view.sections.map((section, sectionIndex) => (
                    <section key={`${section.label}-${sectionIndex}`}>
                      {section.label.toLowerCase() !== 'song' ? (
                        <h3 className="sec-label p-1 font-bold uppercase tracking-[0.08em] bg-[var(--song-section-bg)]/40 text-[var(--song-section)]" dir={textDirection(section.label)}>
                          <span className="sec-label-text">{section.label}</span>
                        </h3>
                      ) : null}
                      <div className="grid gap-1 grid-chords">
                        {section.lines.map((line, index) => (
                          (() => {
                            const inlineTokens = parseInlineChordLine(line, view?.detectedTonic ?? null, view?.detectedIsMinor ?? false)

                            if (inlineTokens.length) {
                              return (
                                <div key={`${section.label}-${sectionIndex}-${index}`} className="chopro-sheet" dir={view.rtl ? 'rtl' : 'ltr'}>
                                  <div className="line-block">
                                    <div className="phrase-row">
                                      {inlineTokens.map((token, tokenIndex) => (
                                        <div key={`${section.label}-${sectionIndex}-${index}-${tokenIndex}`} className="phrase-block">
                                          {token.chord ? (
                                            <ChordTooltip
                                              chord={token.chord}
                                              fingering={chordFingerings.get(token.chord.trim()) ?? null}
                                              as="div"
                                              className="phrase-chord-trigger"
                                              tonic={view?.detectedTonic ?? null}
                                              isMinor={view?.detectedIsMinor ?? false}
                                            >
                                              <div className="phrase-chord">{token.chord}</div>
                                            </ChordTooltip>
                                          ) : (
                                            <div className="phrase-chord empty">.</div>
                                          )}

                                          {token.lyric?.trim() ? (
                                            <div className="phrase-lyric">{token.lyric}</div>
                                          ) : (
                                            <div className="phrase-lyric empty">.</div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )
                            }

                            if (line.includes('|')) {
                              return (
                                <p
                                  key={`${section.label}-${sectionIndex}-${index}`}
                                  className="m-0 whitespace-pre-wrap leading-6 only-chords-line"
                                  style={{
                                    fontFamily: 'var(--chord-font)',
                                    borderBottom: '1px solid var(--light-border)'
                                  }}
                                  dir="ltr"
                                >
                                  {tokenizeCustomLine(line, view?.detectedTonic ?? null, view?.detectedIsMinor ?? false).map((token, tokenIndex) =>
                                    token.text === '|' ? (
                                      <span
                                        key={`${section.label}-${sectionIndex}-${index}-${tokenIndex}`}
                                        className="font-bold text-[var(--chord-delimiter)]"
                                      >
                                        {token.text}
                                      </span>
                                    ) : token.isChord ? (
                                      <ChordTooltip
                                        key={`${section.label}-${sectionIndex}-${index}-${tokenIndex}`}
                                        chord={token.text}
                                        fingering={chordFingerings.get(token.text.trim()) ?? null}
                                        className="inline-flex align-baseline"
                                        tonic={view?.detectedTonic ?? null}
                                        isMinor={view?.detectedIsMinor ?? false}
                                      >
                                        <span className="text-[var(--chord)]">{token.text}</span>
                                      </ChordTooltip>
                                    ) : (
                                      <span
                                        key={`${section.label}-${sectionIndex}-${index}-${tokenIndex}`}
                                        className="text-[var(--text)]"
                                      >
                                        {token.text}
                                      </span>
                                    ),
                                  )}
                                </p>
                              )
                            }

                            return (
                              <div key={`${section.label}-${sectionIndex}-${index}`} className="chopro-sheet" dir={textDirection(line)}>
                                <div className="line-block">
                                  <div className="phrase-row">
                                    <div className="phrase-block">
                                      <div className="phrase-chord empty">.</div>
                                      {line ? (
                                        <div className="phrase-lyric">{line}</div>
                                      ) : (
                                        <div className="phrase-lyric empty">.</div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )
                          })()
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </article>
          ) : route.mode === 'song' && status === 'loading' ? (
            <div className="grid place-items-center rounded-xl border border-[var(--border)] px-4 py-16 text-center text-sm text-[var(--muted)]">
              <div className="grid gap-2">
                <svg className="animate-spin h-8 w-8 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="m-0">Loading song…</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Song not found in this folder.</p>
          )}
        </main>
      )}
    </div>
  )
}
