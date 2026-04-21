import { Chord, ChordProParser } from 'chordsheetjs'
import { sampleSongs } from './samples'

export type SongFormat = 'chopro' | 'chords'
export type SongSource = 'github' | 'local' | 'sample'

export interface SongEntry {
  path: string
  name: string
  title: string
  artist: string | null
  format: SongFormat
  raw: string
  source: SongSource
  rtl: boolean
}

export interface CustomSectionView {
  label: string
  lines: string[]
}

export interface FingeringView {
  chord: string
  fingering: string
}

export interface ChoproTokenView {
  chord?: string
  lyric: string
}

export interface ChoproBlockView {
  type: 'line' | 'section' | 'spacer'
  text?: string
  tokens?: ChoproTokenView[]
  hasLyrics?: boolean
}

export interface SongView {
  title: string
  artist: string | null
  format: SongFormat
  source: SongSource
  capo: string | null
  comment: string | null
  rtl: boolean
  choproBlocks?: ChoproBlockView[]
  sections?: CustomSectionView[]
  fingerings?: FingeringView[]
}

interface GithubContentEntry {
  name: string
  path: string
  type: string
  download_url: string | null
}

interface GithubTreeEntry {
  path: string
  type: string
}

interface GithubRepositoryConfig {
  repository: string | null
  branch: string
  chordsPath: string
}

const CHORD_TAGS = new Set(['bridge', 'chorus', 'intro', 'outro', 'prechorus', 'pre-chorus', 'verse', 'tag'])
const ZW_REGEX = /[\u200B-\u200F\uFEFF]/g
const HIDDEN_CHOPRO_DIRECTIVES = new Set([
  'album',
  'artist',
  'capo',
  'comment_italic',
  'comment_box',
  'composer',
  'duration',
  'end_of_bridge',
  'end_of_chorus',
  'end_of_tab',
  'end_of_verse',
  'eob',
  'eoc',
  'eot',
  'eov',
  'key',
  'meta',
  'sorttitle',
  'start_of_bridge',
  'start_of_chorus',
  'start_of_tab',
  'start_of_verse',
  'sob',
  'soc',
  'sot',
  'sov',
  'subtitle',
  'tempo',
  'time',
  'title',
  'year',
])

const localChordModules = import.meta.glob('../../chords/**/*.{chopro,chords}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function getGithubRepositoryConfig(): GithubRepositoryConfig {
  return {
    repository: import.meta.env.VITE_GITHUB_REPOSITORY?.trim() || null,
    branch: import.meta.env.VITE_GITHUB_BRANCH?.trim() || 'main',
    chordsPath: import.meta.env.VITE_CHORDS_PATH?.trim() || 'chords',
  }
}

function splitRepository(repository: string): { owner: string; name: string } | null {
  const parts = repository.split('/').map((part) => part.trim()).filter(Boolean)

  if (parts.length !== 2) {
    return null
  }

  return { owner: parts[0], name: parts[1] }
}

function buildRawContentUrl(repository: { owner: string; name: string }, branch: string, path: string): string {
  return `https://raw.githubusercontent.com/${repository.owner}/${repository.name}/${branch}/${path}`
}

function fileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

function titleFromStem(fileName: string): string {
  return fileStem(fileName)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function normalizeSingleValue(value: string | string[] | null): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value
}

function hasHebrew(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text)
}

function isLikelyChordToken(token: string): boolean {
  return /^[A-G](?:#|b)?(?:m|maj|min|sus|dim|aug|add|no|M|[0-9]|[#b]|\(|\)|\+|-|\/)*$/i.test(token)
}

function transposeChordToken(token: string, delta: number): string {
  if (!isLikelyChordToken(token)) {
    return token
  }

  const chord = Chord.parse(token)

  if (!chord) {
    return token
  }

  try {
    return chord.transpose(delta).toString()
  } catch {
    return token
  }
}

function cleanText(value: string): string {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(ZW_REGEX, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim()
}

function parseChordedLine(line: string): { lyrics: string; chords: { chord: string; pos: number }[] } {
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

    const chord = cleanText(match[1] ?? '')
    if (chord) {
      chords.push({ chord, pos: lyrics.length })
    }

    cursor = end
  }

  const tail = line.slice(cursor)
  if (tail) {
    lyrics += tail
  }

  return { lyrics, chords }
}

function splitChordLineIntoTokens(line: string): ChoproTokenView[] {
  const parsed = parseChordedLine(line)

  if (parsed.chords.length === 0) {
    return parsed.lyrics.trim() ? [{ lyric: parsed.lyrics }] : []
  }

  const tokens: ChoproTokenView[] = []

  for (let index = 0; index < parsed.chords.length; index += 1) {
    const current = parsed.chords[index]
    const next = parsed.chords[index + 1]

    if (index === 0) {
      const leading = parsed.lyrics.slice(0, current.pos)
      if (leading.trim()) {
        tokens.push({ lyric: leading })
      }
    }

    tokens.push({
      chord: current.chord,
      lyric: parsed.lyrics.slice(current.pos, next ? next.pos : parsed.lyrics.length),
    })
  }

  return tokens
}

function transposeChoproLine(line: string, delta: number): string {
  if (!delta) {
    return line
  }

  return line.replace(/\[([^\]]+)\]/g, (fullMatch, rawChord: string) => {
    const chord = cleanText(rawChord)
    if (!chord) {
      return fullMatch
    }

    return `[${transposeChordToken(chord, delta)}]`
  })
}

function parseChoproDirectiveLine(line: string):
  | { kind: 'none' }
  | { kind: 'section'; text: string }
  | { kind: 'skip' } {
  const directiveMatch = line.match(/^\{\s*([^}:]+)\s*(?::\s*([^}]*))?\s*\}$/)
  if (!directiveMatch) {
    return { kind: 'none' }
  }

  const key = cleanText(directiveMatch[1] ?? '')
  const value = cleanText(directiveMatch[2] ?? '')
  const normalizedKey = key.toLowerCase().replace(/[_\s-]+/g, '_')

  if (!value) {
    return key ? { kind: 'section', text: key } : { kind: 'skip' }
  }

  if (normalizedKey === 'c' || normalizedKey === 'comment') {
    return value ? { kind: 'section', text: value } : { kind: 'skip' }
  }

  if (HIDDEN_CHOPRO_DIRECTIVES.has(normalizedKey)) {
    return { kind: 'skip' }
  }

  return { kind: 'section', text: value || key }
}

function sanitizeChoproForParser(raw: string): string {
  return String(raw)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((rawLine) => {
      const line = rawLine.trim()
      const directiveMatch = line.match(/^\{\s*([^}:]+)\s*(?::\s*([^}]*))?\s*\}$/)

      if (!directiveMatch) {
        return rawLine
      }

      const key = cleanText(directiveMatch[1] ?? '')
      const value = cleanText(directiveMatch[2] ?? '')
      const normalizedKey = key.toLowerCase().replace(/[_\s-]+/g, '_')

      if (!value && key) {
        return `{c: ${key}}`
      }

      if (normalizedKey === 'c' || normalizedKey === 'comment' || HIDDEN_CHOPRO_DIRECTIVES.has(normalizedKey)) {
        return rawLine
      }

      if (value) {
        return `{c: ${value}}`
      }

      return rawLine
    })
    .join('\n')
}

function buildChoproBlocks(raw: string, transpose: number): ChoproBlockView[] {
  const lines = String(raw).replace(/\r\n?/g, '\n').split('\n')
  const blocks: ChoproBlockView[] = []

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    const directive = parseChoproDirectiveLine(line.trim())
    if (directive.kind === 'section') {
      blocks.push({ type: 'section', text: directive.text })
      continue
    }

    if (directive.kind === 'skip') {
      continue
    }

    if (!line.trim()) {
      blocks.push({ type: 'spacer' })
      continue
    }

    const capoMatch = line.trim().match(/^(?:קאפו|capo)\s+(.+)$/i)
    if (capoMatch) {
      const text = cleanText(capoMatch[0])
      if (text) {
        blocks.push({ type: 'section', text })
        continue
      }
    }

    const tokens = splitChordLineIntoTokens(transposeChoproLine(line, transpose))
    blocks.push({
      type: 'line',
      tokens,
      hasLyrics: tokens.some((token) => token.lyric.trim()),
    })
  }

  return blocks
}

function transposeChordText(text: string, delta: number): string {
  if (!delta) {
    return text
  }

  return text
    .split(/(\|)/)
    .map((segment) => {
      if (segment === '|') {
        return segment
      }

      return segment.replace(/\S+/g, (token) => {
        const stripped = token.match(/^([\[({<"']*)(.*?)([\])}>.,;:!?"']*)$/)

        if (!stripped) {
          return token
        }

        const [, prefix, core, suffix] = stripped

        if (!core) {
          return token
        }

        return `${prefix}${transposeChordToken(core, delta)}${suffix}`
      })
    })
    .join('')
}

function formatSectionLabel(rawLabel: string): string {
  const normalized = rawLabel.toLowerCase().replace(/[_-]+/g, ' ')

  if (normalized === 'prechorus') {
    return 'Pre-Chorus'
  }

  return normalized.replace(/\b\w/g, (character) => character.toUpperCase())
}

function parseCustomMetadata(raw: string) {
  const metadata = new Map<string, string>()
  const fingerings: FingeringView[] = []
  const sections: CustomSectionView[] = []
  let currentSection: CustomSectionView | null = null

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const tagMatch = trimmed.match(/^\{([^}:]+)(?::\s*([^}]*))?\}\s*(?:#.*)?$/)

    if (tagMatch) {
      const key = tagMatch[1].trim()
      const value = tagMatch[2]?.trim() ?? null
      const normalizedKey = key.toLowerCase()

      if (!value && CHORD_TAGS.has(normalizedKey)) {
        currentSection = { label: formatSectionLabel(normalizedKey), lines: [] }
        sections.push(currentSection)
        continue
      }

      if (value && /^[xX0-9\-]+$/.test(value)) {
        fingerings.push({ chord: key, fingering: value })
        continue
      }

      if (value) {
        metadata.set(normalizedKey, value)
        continue
      }
    }

    if (!currentSection) {
      currentSection = { label: 'Song', lines: [] }
      sections.push(currentSection)
    }

    currentSection.lines.push(transposeChordText(line, 0))
  }

  return { metadata, fingerings, sections }
}

function summarizeCustomSong(raw: string, fileName: string) {
  const { metadata } = parseCustomMetadata(raw)

  const title = metadata.get('title') ?? titleFromStem(fileName)
  const artist = metadata.get('artist') ?? null
  const capo = metadata.get('capo') ?? null
  const comment = metadata.get('comment') ?? null

  return {
    title,
    artist,
    capo,
    comment,
    rtl: hasHebrew(raw) || hasHebrew(title) || hasHebrew(artist ?? ''),
  }
}

function summarizeChoproSong(raw: string, fileName: string) {
  const parser = new ChordProParser()
  const song = parser.parse(sanitizeChoproForParser(raw))

  return {
    title: normalizeSingleValue(song.getSingleMetadataValue('title')) ?? titleFromStem(fileName),
    artist: normalizeSingleValue(song.getSingleMetadataValue('artist')),
    capo: normalizeSingleValue(song.getSingleMetadataValue('capo')),
    comment: normalizeSingleValue(song.getSingleMetadataValue('comment')),
    rtl:
      hasHebrew(raw) ||
      hasHebrew(normalizeSingleValue(song.getSingleMetadataValue('title')) ?? '') ||
      hasHebrew(normalizeSingleValue(song.getSingleMetadataValue('artist')) ?? ''),
  }
}

function buildEntry(fileName: string, raw: string, source: SongSource, path: string): SongEntry {
  const format: SongFormat = fileName.endsWith('.chopro') ? 'chopro' : 'chords'
  const summary = format === 'chopro' ? summarizeChoproSong(raw, fileName) : summarizeCustomSong(raw, fileName)

  return {
    path,
    name: fileName,
    title: summary.title,
    artist: summary.artist,
    format,
    raw,
    source,
    rtl: summary.rtl,
  }
}

async function fetchSongText(url: string): Promise<string> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`)
  }

  return response.text()
}

export async function loadSongLibrary(): Promise<SongEntry[]> {
  const config = getGithubRepositoryConfig()
  const repository = config.repository ? splitRepository(config.repository) : null

  if (!repository) {
    const localSongs = loadLocalWorkspaceSongs()
    return localSongs.length ? localSongs : sampleSongs
  }

  const treeUrl = new URL(
    `https://api.github.com/repos/${repository.owner}/${repository.name}/git/trees/${encodeURIComponent(config.branch)}`,
  )
  treeUrl.searchParams.set('recursive', '1')

  try {
    const response = await fetch(treeUrl)

    if (!response.ok) {
      return loadSongLibraryByContentsApi(repository, config)
    }

    const payload = (await response.json()) as { tree?: GithubTreeEntry[] }
    const files = (payload.tree ?? [])
      .filter((item) => item.type === 'blob')
      .filter((item) => item.path.startsWith(`${config.chordsPath}/`))
      .filter((item) => /\.(chopro|chords)$/i.test(item.path))
      .sort((left, right) => left.path.localeCompare(right.path))

    const entries = await Promise.all(
      files.map(async (item) => {
        const raw = await fetchSongText(buildRawContentUrl(repository, config.branch, item.path))
        const fileName = item.path.split('/').pop() ?? item.path

        return buildEntry(fileName, raw, 'github', item.path)
      }),
    )

    if (entries.length) {
      return entries
    }

    const localSongs = loadLocalWorkspaceSongs()
    return localSongs.length ? localSongs : sampleSongs
  } catch {
    const fromContentsApi = await loadSongLibraryByContentsApi(repository, config)
    if (fromContentsApi.length) {
      return fromContentsApi
    }

    const localSongs = loadLocalWorkspaceSongs()
    return localSongs.length ? localSongs : sampleSongs
  }
}

function loadLocalWorkspaceSongs(): SongEntry[] {
  const entries = Object.entries(localChordModules)
    .filter(([path]) => /\.(chopro|chords)$/i.test(path))
    .map(([path, raw]) => {
      const normalizedPath = path.replace(/^\.\.\/\.\.\//, '')
      const fileName = normalizedPath.split('/').pop() ?? normalizedPath
      return buildEntry(fileName, raw, 'local', normalizedPath)
    })
    .sort((left, right) => left.path.localeCompare(right.path))

  return entries
}

async function loadSongLibraryByContentsApi(
  repository: { owner: string; name: string },
  config: GithubRepositoryConfig,
): Promise<SongEntry[]> {
  const listingUrl = new URL(
    `https://api.github.com/repos/${repository.owner}/${repository.name}/contents/${config.chordsPath}`,
  )
  listingUrl.searchParams.set('ref', config.branch)

  try {
    const response = await fetch(listingUrl)

    if (!response.ok) {
      return []
    }

    const listing = (await response.json()) as GithubContentEntry[]
    const files = listing
      .filter((item) => item.type === 'file' && /\.(chopro|chords)$/i.test(item.name))
      .sort((left, right) => left.name.localeCompare(right.name))

    const entries = await Promise.all(
      files.map(async (item) => {
        const raw = await fetchSongText(
          item.download_url ?? buildRawContentUrl(repository, config.branch, item.path),
        )

        return buildEntry(item.name, raw, 'github', item.path)
      }),
    )

    return entries
  } catch {
    return []
  }
}

function renderChoproSong(entry: SongEntry, transpose: number): SongView {
  const parser = new ChordProParser()
  const parsed = parser.parse(sanitizeChoproForParser(entry.raw))

  return {
    title: normalizeSingleValue(parsed.getSingleMetadataValue('title')) ?? entry.title,
    artist: normalizeSingleValue(parsed.getSingleMetadataValue('artist')) ?? entry.artist,
    capo: normalizeSingleValue(parsed.getSingleMetadataValue('capo')),
    comment: normalizeSingleValue(parsed.getSingleMetadataValue('comment')),
    rtl:
      entry.rtl ||
      hasHebrew(parsed.getSingleMetadataValue('title') ?? '') ||
      hasHebrew(parsed.getSingleMetadataValue('artist') ?? ''),
    choproBlocks: buildChoproBlocks(entry.raw, transpose),
    format: entry.format,
    source: entry.source,
  }
}

function renderCustomSong(entry: SongEntry, transpose: number): SongView {
  const { metadata, fingerings, sections } = parseCustomMetadata(entry.raw)
  const transposedSections = sections.map((section) => ({
    label: section.label,
    lines: section.lines.map((line) => transposeChordText(line, transpose)),
  }))

  const transposedFingerings = fingerings.map((definition) => ({
    chord: transposeChordToken(definition.chord, transpose),
    fingering: definition.fingering,
  }))

  return {
    title: metadata.get('title')?.trim() || entry.title,
    artist: metadata.get('artist')?.trim() || null,
    capo: metadata.get('capo') ?? null,
    comment: metadata.get('comment') ?? null,
    rtl: entry.rtl,
    sections: transposedSections,
    fingerings: transposedFingerings,
    format: entry.format,
    source: entry.source,
  }
}

export function buildSongView(entry: SongEntry, transpose: number): SongView {
  return entry.format === 'chopro' ? renderChoproSong(entry, transpose) : renderCustomSong(entry, transpose)
}