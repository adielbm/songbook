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

const SETTINGS_KEY = 'settings'
const SYNC_META_PREFIX = 'sync:'

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
  const records = (await database.getAllFromIndex('songs', 'repoKey', key)) as StoredSong[]
  return records
    .map((record) => ({
      path: record.path,
      name: record.name,
      title: record.title,
      artist: record.artist,
      format: record.format,
      raw: record.raw,
      source: 'cache' as const,
      rtl: record.rtl,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

export async function replaceCachedSongs(key: string, songs: SongEntry[]): Promise<void> {
  const database = await db()
  const tx = database.transaction(['songs'], 'readwrite')
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
