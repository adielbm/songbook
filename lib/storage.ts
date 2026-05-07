import { openDB } from 'idb'
import type { SongEntry } from './songbook-core'

const DB_NAME = 'songbook'
const DB_VERSION = 1

export interface RepoSettings {
  repository: string
  branch: string
  chordsPath: string
  token: string
}

interface StoredSong extends SongEntry {
  id: string
  repoKey: string
}

interface SyncMeta {
  key: string
  lastSyncedAt: number | null
  lastError: string | null
  count: number
}

function normalizeCachedArtists(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((artist) => String(artist).trim()).filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((artist) => artist.trim())
      .filter(Boolean)
  }

  return []
}

const SETTINGS_KEY = 'settings'
const SYNC_META_PREFIX = 'sync:'
const SONG_SHAS_PREFIX = 'song-shas:'

export interface CachedSongSnapshot {
  song: SongEntry
  sha: string | null
}

async function db() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      const songs = database.createObjectStore('songs', { keyPath: 'id' })
      songs.createIndex('repoKey', 'repoKey')
      database.createObjectStore('meta', { keyPath: 'key' })
    },
  })
}

export function repoKey(settings: Pick<RepoSettings, 'repository' | 'branch' | 'chordsPath'>): string {
  return `${settings.repository}::${settings.branch}::${settings.chordsPath}`
}

export async function loadSettings(): Promise<RepoSettings | null> {
  const raw = localStorage.getItem(SETTINGS_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as RepoSettings
    if (!parsed.repository || !parsed.branch || typeof parsed.chordsPath !== 'string' || !parsed.token) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export async function saveSettings(settings: RepoSettings): Promise<void> {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export async function clearSettings(): Promise<void> {
  localStorage.removeItem(SETTINGS_KEY)
}

export async function loadCachedSongs(key: string): Promise<SongEntry[]> {
  const database = await db()
  const records = (await database.getAllFromIndex('songs', 'repoKey', key)) as Record<string, any>[]
  return records
    .map((record) => ({
      path: record.path,
      name: record.name,
      title: record.title,
      artists: normalizeCachedArtists(record.artists ?? record.artist),
      format: record.format,
      raw: record.raw,
      source: 'cache' as const,
      rtl: record.rtl,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

export async function loadCachedSongsWithShas(key: string): Promise<Map<string, CachedSongSnapshot>> {
  const songs = await loadCachedSongs(key)
  const database = await db()
  const stored = (await database.get('meta', `${SONG_SHAS_PREFIX}${key}`)) as
    | { key: string; value?: Record<string, string> }
    | undefined
  const pathShas = stored?.value ?? {}

  const snapshots = new Map<string, CachedSongSnapshot>()

  for (const song of songs) {
    snapshots.set(song.path, {
      song,
      sha: pathShas[song.path] ?? null,
    })
  }

  return snapshots
}

export async function replaceCachedSongs(
  key: string,
  songs: SongEntry[],
  pathShas?: Record<string, string>,
): Promise<void> {
  const database = await db()
  const tx = database.transaction(['songs', 'meta'], 'readwrite')
  const store = tx.objectStore('songs')
  const index = store.index('repoKey')
  let cursor = await index.openCursor(key)

  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }

  for (const song of songs) {
    const record: StoredSong = {
      ...song,
      id: `${key}::${song.path}`,
      repoKey: key,
    }
    await store.put(record)
  }

  const nextShas: Record<string, string> = {}
  for (const song of songs) {
    const sha = pathShas?.[song.path]
    if (sha) {
      nextShas[song.path] = sha
    }
  }

  await tx.objectStore('meta').put({ key: `${SONG_SHAS_PREFIX}${key}`, value: nextShas })

  await tx.done
}

export async function loadSyncMeta(key: string): Promise<SyncMeta> {
  const database = await db()
  const found = (await database.get('meta', `${SYNC_META_PREFIX}${key}`)) as SyncMeta | undefined
  return (
    found ?? {
      key,
      lastSyncedAt: null,
      lastError: null,
      count: 0,
    }
  )
}

export async function saveSyncMeta(meta: SyncMeta): Promise<void> {
  const database = await db()
  await database.put('meta', {
    ...meta,
    key: `${SYNC_META_PREFIX}${meta.key}`,
  })
}
