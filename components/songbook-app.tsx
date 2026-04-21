'use client'

import {
  Button,
  Card,
  Chip,
  Label,
  Input,
  SearchField,
  Separator,
  Spinner,
  TextField,
  TextArea,
} from '@heroui/react'
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
} from 'lucide-react'
import { pullSongsFromGithub } from '@/lib/github'
import { buildSongView, fileStem, type SongEntry, type SongView } from '@/lib/songbook-core'
import { sampleSongs } from '@/lib/samples'
import {
  clearSettings,
  loadCachedSongs,
  loadSettings,
  loadSyncMeta,
  replaceCachedSongs,
  repoKey,
  saveSettings,
  saveSyncMeta,
  type RepoSettings,
} from '@/lib/storage'

const MIN_FONT_SIZE = 14
const MAX_FONT_SIZE = 28
const DEFAULT_FONT_SIZE = 18

type LineToken = {
  text: string
  isChord: boolean
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

type AppRoute = RouteHome | RouteFolder | RouteSong | RouteSettings

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

function tokenizeCustomLine(line: string): LineToken[] {
  return line
    .split(/(\s+|\||\(|\)|\[|\]|\{|\}|,|\.|:|;|\+|-|\\|\/)/g)
    .filter(Boolean)
    .map((part) => ({
      text: part,
      isChord: /^(?:[A-G](?:#|b)?(?:m|maj|min|sus|dim|aug|add|no|M|[0-9]|[#b]|\(|\)|\+|-|\/)*)$/i.test(part),
    }))
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

  const haystack = `${entry.song.title} ${entry.song.artist ?? ''} ${entry.song.path}`.toLowerCase()
  return haystack.includes(normalizedQuery)
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

function parseHashRoute(): AppRoute {
  const hash = window.location.hash.replace(/^#/, '')
  const cleaned = hash.replace(/^\//, '')
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

function routeHash(route: AppRoute): string {
  if (route.mode === 'home') {
    return '#/'
  }

  if (route.mode === 'settings') {
    return '#/settings/'
  }

  if (route.mode === 'folder') {
    const folderPath = route.folder
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/')

    return folderPath ? `#/folder/${folderPath}/` : '#/folder/'
  }

  const folderPath = route.folder
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return folderPath ? `#/song/${folderPath}/${encodeURIComponent(route.slug)}/` : `#/song/${encodeURIComponent(route.slug)}/`
}

function navigate(route: AppRoute): void {
  const nextHash = routeHash(route)

  if (window.location.hash === nextHash) {
    return
  }

  window.location.hash = nextHash
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
      <Button aria-label="Toggle theme" variant="secondary" isDisabled>
        <SunMedium size={16} />
      </Button>
    )
  }

  const current = resolvedTheme ?? theme
  const isDark = current === 'dark'

  return (
    <Button
      aria-label="Toggle theme"
      variant={isDark ? 'secondary' : 'primary'}
      onPress={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <MoonStar size={16} /> : <SunMedium size={16} />}
    </Button>
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
    setRoute(parseHashRoute())
    const onHashChange = () => setRoute(parseHashRoute())

    window.addEventListener('hashchange', onHashChange)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
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
      const pulledSongs = await pullSongsFromGithub(settings, (done, total) => {
        setPullProgress({ done, total })
      })

      if (!pulledSongs.length) {
        throw new Error('No .chopro or .chords files were found in the configured path.')
      }

      await replaceCachedSongs(key, pulledSongs)
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
      .map((folder) => ({ kind: 'folder', folder }))

    const songRows = routeSongs
      .filter((entry) => (normalizedQuery === '' ? entry.folder === currentFolder : true))
      .filter((entry) => songMatchesQuery(entry, normalizedQuery))
      .map((entry) => ({
        kind: 'song',
        folder: entry.folder,
        slug: entry.slug,
        song: entry.song,
      }))

    return [...folderRows, ...songRows]
  }, [currentFolder, normalizedQuery, routeSongs])

  const visibleSongCount = visibleRows.filter((row) => row.kind === 'song').length

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
    <div className="mx-auto min-h-screen max-w-6xl px-1.5 py-2 md:px-3" style={{ ['--song-font-size' as string]: `${fontSize}px` }}>
      <header className="no-print z-20 mb-3 rounded-[1.2rem] border border-[var(--line)] bg-[color-mix(in_srgb,var(--panel)_90%,transparent)] p-1.5 shadow-[0_12px_30px_rgba(0,0,0,0.06)] backdrop-blur supports-[backdrop-filter]:bg-[color-mix(in_srgb,var(--panel)_84%,transparent)]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[0.65rem] text-[var(--muted)]">
            <span>Sync: {syncMetaText}</span>
            {pulling ? (
              <span className="inline-flex items-center gap-2">
                <Spinner size="sm" />
                {pullProgress.done}/{pullProgress.total || '?'}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Button
              aria-label="Sync repository"
              variant="secondary"
              onPress={() => {
                if (!settings) {
                  navigate({ mode: 'settings' })
                  return
                }
                void handlePull()
              }}
              className="gap-1.5"
            >
              <RefreshCw size={16} className={pulling ? 'animate-spin' : ''} />
              <span className="text-xs font-medium">{songs.length}</span>
            </Button>
            <Button
              aria-label="Open settings"
              variant={route.mode === 'settings' ? 'primary' : 'outline'}
              onPress={() => {
                const nextRoute: AppRoute = { mode: 'settings' }
                setRoute(nextRoute)
                navigate(nextRoute)
              }}
            >
              <Settings2 size={16} />
            </Button>
          </div>
        </div>

        <div className="grid gap-2">
          <SearchField className="w-full" fullWidth onChange={setQuery} value={query} variant="secondary">
            <SearchField.Group className="h-9 rounded-full border border-[var(--line)] bg-[var(--panel)] px-2 shadow-[0_6px_16px_rgba(0,0,0,0.05)] transition-colors data-[focus-within=true]:border-[var(--accent)] data-[focus-within=true]:bg-[var(--panel)]">
              <SearchField.SearchIcon className="pointer-events-none shrink-0 text-[var(--muted)]" />
              <SearchField.Input aria-label="Search songs or folders" className="text-sm placeholder:text-[var(--muted)]" placeholder="Search" />
              <SearchField.ClearButton className="shrink-0 rounded-full bg-[var(--panel-soft)] p-1 text-[var(--muted)]" />
            </SearchField.Group>
          </SearchField>
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
          <Card className="overflow-hidden border border-[var(--line)] bg-[var(--panel)] shadow-[0_16px_40px_rgba(0,0,0,0.08)]">
            <Card.Header className="bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent)_18%,transparent),transparent)]">
              <div className="flex w-full items-start justify-between gap-3">
                <div className="max-w-2xl">
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
                    <Settings2 size={12} />
                    Connection settings
                  </div>
                  <h1 className="m-0 text-2xl font-semibold">Connect your private repository</h1>
                  <p className="m-0 mt-1 text-sm text-[var(--muted)]">
                    Save an owner/repo, branch, path, and read-only token. The app keeps a local browser cache for offline reading.
                  </p>
                </div>

                <Button
                  aria-label="Back"
                  variant="primary"
                  onPress={() => {
                    const nextRoute: AppRoute = selectedSongEntry ? { mode: 'song', folder: selectedSongEntry.folder, slug: selectedSongEntry.slug } : { mode: 'home' }
                    setRoute(nextRoute)
                    navigate(nextRoute)
                  }}
                >
                  <ChevronLeft size={16} />
                </Button>
              </div>
            </Card.Header>
            <Separator />
            <Card.Content>
              <form className="grid gap-4" onSubmit={handleSaveSettings}>
                <div className="grid gap-3 md:grid-cols-2">
                  <TextField className="grid gap-1" variant="secondary">
                    <Label>Repository</Label>
                    <Input
                      placeholder="owner/repo"
                      value={draft.repository}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setDraft((state) => ({ ...state, repository: value }))
                      }}
                    />
                  </TextField>
                  <TextField className="grid gap-1" variant="secondary">
                    <Label>Branch</Label>
                    <Input
                      placeholder="main"
                      value={draft.branch}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setDraft((state) => ({ ...state, branch: value }))
                      }}
                    />
                  </TextField>
                  <TextField className="grid gap-1" variant="secondary">
                    <Label>Chord path (optional)</Label>
                    <Input
                      placeholder="leave blank for repo root"
                      value={draft.chordsPath}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setDraft((state) => ({ ...state, chordsPath: value }))
                      }}
                    />
                  </TextField>
                  <TextField className="grid gap-1" variant="secondary">
                    <Label>GitHub token</Label>
                    <Input
                      placeholder="read-only token"
                      type="password"
                      value={draft.token}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        setDraft((state) => ({ ...state, token: value }))
                      }}
                    />
                  </TextField>
                </div>

                <TextField className="grid gap-1" variant="secondary">
                  <Label>Browser storage</Label>
                  <TextArea
                    readOnly
                    value="Songs are saved in IndexedDB so the app can stay readable offline after you pull changes."
                  />
                </TextField>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="primary">
                    <UploadCloud size={16} />
                    Save settings
                  </Button>
                  <Button
                    aria-label="Sync repository"
                    isDisabled={!settings}
                    variant="primary"
                    onPress={() => {
                      void handlePull()
                    }}
                  >
                    <RefreshCw size={16} />
                  </Button>
                  <Button variant="danger" onPress={() => void handleResetSettings()}>
                    <X size={16} />
                    Clear settings
                  </Button>
                </div>
              </form>
            </Card.Content>
          </Card>
        </main>
      ) : route.mode === 'home' || route.mode === 'folder' ? (
        <main className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {route.mode === 'folder' ? (
                <Button
                  aria-label="Go to parent folder"
                  variant="secondary"
                  onPress={() => {
                    const parentFolder = currentFolder.includes('/') ? currentFolder.split('/').slice(0, -1).join('/') : ''
                    const nextRoute: AppRoute = parentFolder ? { mode: 'folder', folder: parentFolder } : { mode: 'home' }
                    setRoute(nextRoute)
                    navigate(nextRoute)
                  }}
                >
                  <ChevronLeft size={16} />
                </Button>
              ) : null}
              <h2 className="m-0 text-xl font-semibold">{route.mode === 'folder' ? folderName(currentFolder) : 'All songs'}</h2>
            </div>

            <Chip variant="secondary">Songs {visibleSongCount}</Chip>
          </div>

          <Card className="border border-[var(--line)] bg-[var(--panel)]">
            {!normalizedQuery && (
              <>
                <Card.Header className="flex items-center justify-between gap-2">
                  <div>
                    <p className="m-0 text-sm text-[var(--muted)]">{currentFolder || 'Repository root'}</p>
                  </div>
                </Card.Header>
                <Separator />
              </>
            )}
            <Card.Content className="grid gap-1 p-1">
              {visibleRows.length ? (
                visibleRows.map((row) => {
                  if (row.kind === 'folder') {
                    const nextRoute: AppRoute = { mode: 'folder', folder: row.folder }

                    return (
                      <a
                        key={row.folder}
                        className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-transparent px-2 py-1.5 text-left text-sm text-[var(--text)] transition-colors hover:border-[var(--line)] hover:bg-[var(--panel-soft)] focus-visible:border-[var(--accent)] focus-visible:bg-[var(--panel-soft)] focus-visible:outline-none"
                        href={routeHash(nextRoute)}
                        onClick={() => {
                          setRoute(nextRoute)
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
                      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-transparent px-2 py-1.5 text-left text-sm text-[var(--text)] transition-colors hover:border-[var(--line)] hover:bg-[var(--panel-soft)] focus-visible:border-[var(--accent)] focus-visible:bg-[var(--panel-soft)] focus-visible:outline-none"
                      href={routeHash(nextRoute)}
                      onClick={() => {
                        setRoute(nextRoute)
                      }}
                    >
                      <span className="inline-flex items-center gap-2 text-[var(--muted)]">
                        <Music2 size={16} />
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate">{row.song.title}</strong>
                        {row.song.artist ? <span className="block truncate text-xs text-[var(--muted)]">{row.song.artist}</span> : null}
                      </span>
                    </a>
                  )
                })
              ) : (
                <p className="px-3 py-4 text-sm text-[var(--muted)]">No folders or songs found.</p>
              )}
            </Card.Content>
          </Card>
        </main>
      ) : (
        <main className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onPress={() => {
                const nextRoute: AppRoute = { mode: 'folder', folder: route.folder }
                setRoute(nextRoute)
                navigate(nextRoute)
              }}
            >
              <ChevronLeft size={16} />
              {route.folder || 'Folders'}
            </Button>
          </div>

          {view ? (
            <div className="no-print flex flex-wrap items-center gap-1.5">
              <Button aria-label="Reset transpose" variant={transpose === 0 ? 'outline' : 'primary'} onPress={() => setTranspose(0)}>
                <RotateCcw size={16} />
              </Button>
              <span
                className={[
                  'inline-flex h-9 min-w-9 items-center justify-center rounded-full border px-2 text-sm font-semibold tabular-nums',
                  transpose === 0
                    ? 'border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]'
                    : 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,var(--panel))] text-[var(--accent)]',
                ].join(' ')}
                aria-label={`Transpose ${transpose}`}
              >
                {transpose > 0 ? `+${transpose}` : transpose}
              </span>
              <Button aria-label="Transpose up" variant="outline" onPress={() => setTranspose((value) => value + 1)}>
                <Plus size={16} />
              </Button>
              <Button aria-label="Transpose down" variant="outline" onPress={() => setTranspose((value) => value - 1)}>
                <Minus size={16} />
              </Button>
              <Button aria-label="Decrease text size" variant="outline" onPress={() => setFontSize((size) => Math.max(MIN_FONT_SIZE, size - 1))}>
                <AArrowDown size={16} />
              </Button>
              <Button aria-label="Increase text size" variant="outline" onPress={() => setFontSize((size) => Math.min(MAX_FONT_SIZE, size + 1))}>
                <AArrowUp size={16} />
              </Button>
            </div>
          ) : null}

          {view ? (
            <article className="song-sheet rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 md:p-4" dir={view.format === 'chords' ? 'ltr' : view.rtl ? 'rtl' : 'ltr'}>
              <div className="mb-3 grid gap-1">
                {view.capo ? <p className="m-0 text-sm text-[var(--muted)]">Capo {view.capo}</p> : null}
                {view.fingerings?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {view.fingerings.map((definition) => (
                      <Chip key={`${definition.chord}-${definition.fingering}`} variant="soft" color="success">
                        {definition.chord} {definition.fingering}
                      </Chip>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="mb-2">
                <h1 className="m-0 text-2xl font-semibold">{view.title}</h1>
                {view.artist ? <p className="m-0 text-sm text-[var(--muted)]">{view.artist}</p> : null}
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
                                <div className="phrase-chord empty">&nbsp;</div>
                              )}

                              {token.lyric ? (
                                <div className="phrase-lyric">{token.lyric}</div>
                              ) : (
                                <div className="phrase-lyric empty">&nbsp;</div>
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
                <div className="mt-3 grid gap-3" dir="ltr">
                  {view.sections.map((section) => (
                    <section key={section.label}>
                      <h3 className="mb-1 text-xs uppercase tracking-[0.08em] text-[var(--accent)]">{section.label}</h3>
                      <div className="grid gap-1">
                        {section.lines.map((line, index) => (
                          <p key={`${section.label}-${index}`} className="m-0 whitespace-pre-wrap leading-6">
                            {tokenizeCustomLine(line).map((token, tokenIndex) => (
                              <span
                                key={`${section.label}-${index}-${tokenIndex}`}
                                className={token.isChord ? 'font-mono text-[var(--text)]' : 'text-[var(--muted)]'}
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
            <p className="text-sm text-[var(--muted)]">Song not found in this folder.</p>
          )}
        </main>
      )}
    </div>
  )
}
