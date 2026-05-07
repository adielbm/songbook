import { Chord, ChordProParser } from 'chordsheetjs'

export type SongFormat = 'chopro' | 'chords'
export type SongSource = 'github' | 'cache' | 'sample'

export interface SongEntry {
  path: string
  name: string
  title: string
  artists: string[]
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
  artists: string[]
  format: SongFormat
  source: SongSource
  capo: string | null
  comment: string | null
  rtl: boolean
  detectedTonic: string | null
  detectedIsMinor: boolean
  choproBlocks?: ChoproBlockView[]
  sections?: CustomSectionView[]
  fingerings?: FingeringView[]
}

const CHORD_TAGS = new Set(['bridge', 'chorus', 'intro', 'outro', 'prechorus', 'pre-chorus', 'verse', 'tag'])
const ZW_REGEX = /[\u200B-\u200F\uFEFF]/g
const CUSTOM_METADATA_ALIASES = new Map<string, 'title' | 'artist' | 'capo' | 'comment'>([
  ['title', 'title'],
  ['כותרת', 'title'],
  ['artist', 'artist'],
  ['אמן', 'artist'],
  ['capo', 'capo'],
  ['קאפו', 'capo'],
  ['comment', 'comment'],
  ['comments', 'comment'],
  ['הערות', 'comment'],
])
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

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0,
  'B#': 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  F: 5,
  'E#': 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
  Cb: 11,
}

const SEMITONE_TO_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const SEMITONE_TO_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const

function semitoneFromNote(note: string): number | null {
  return NOTE_TO_SEMITONE[note] ?? null
}

function majorKeyToSharpsMap(): Record<string, number> {
  return {
    C: 0,
    G: 1,
    D: 2,
    A: 3,
    E: 4,
    B: 5,
    'F#': 6,
    'C#': 7,
    F: -1,
    Bb: -2,
    Eb: -3,
    Ab: -4,
    Db: -5,
    Gb: -6,
    Cb: -7,
  }
}

function getKeySignatureSharps(tonic: string, isMinor: boolean): number {
  const tonicSemitone = semitoneFromNote(tonic)
  if (tonicSemitone === null) {
    return 0
  }

  let root = tonic
  if (isMinor) {
    root = SEMITONE_TO_SHARP[(tonicSemitone + 3) % 12]
  }

  return majorKeyToSharpsMap()[root] ?? 0
}

function normalizeNoteSpelling(note: string): string {
  const cleaned = cleanText(note)
  if (!cleaned) {
    return cleaned
  }

  const formatted = `${cleaned[0].toUpperCase()}${cleaned.slice(1).replace(/[^#b]/g, '')}`
  const semitone = semitoneFromNote(formatted)

  if (semitone === null) {
    return formatted
  }

  // Always prefer flat-style spellings for display (e.g., Bb instead of A#)
  return SEMITONE_TO_FLAT[semitone]
}

function normalizeNoteSpellingForKey(note: string, keySignatureSharps: number): string {
  const cleaned = cleanText(note)
  if (!cleaned) {
    return cleaned
  }

  const formatted = `${cleaned[0].toUpperCase()}${cleaned.slice(1).replace(/[^#b]/g, '')}`
  const semitone = semitoneFromNote(formatted)

  if (semitone === null) {
    return formatted
  }

  // Always prefer flat-style spellings regardless of key signature
  return SEMITONE_TO_FLAT[semitone]
}

export function normalizeChordSymbol(chord: string): string {
  const cleaned = cleanText(chord)
  if (!cleaned) {
    return cleaned
  }

  const parsed = cleaned.match(/^([A-Ga-g])([#b]?)(.*)$/)
  if (!parsed) {
    return cleaned
  }

  const root = normalizeNoteSpelling(`${parsed[1].toUpperCase()}${parsed[2] ?? ''}`)
  let rest = parsed[3] ?? ''

  rest = rest.replace(/\/([A-Ga-g])([#b]?)/g, (_match, bassRoot: string, accidental: string) => {
    return `/${normalizeNoteSpelling(`${bassRoot.toUpperCase()}${accidental ?? ''}`)}`
  })

  return `${root}${rest}`
}

export function normalizeChordSymbolForKey(
  chord: string,
  tonic: string | null,
  isMinor: boolean,
): string {
  const cleaned = cleanText(chord)
  if (!cleaned || !tonic) {
    return normalizeChordSymbol(chord)
  }

  const parsed = cleaned.match(/^([A-Ga-g])([#b]?)(.*)$/)
  if (!parsed) {
    return cleaned
  }

  const keySignatureSharps = getKeySignatureSharps(tonic, isMinor)
  const root = normalizeNoteSpellingForKey(`${parsed[1].toUpperCase()}${parsed[2] ?? ''}`, keySignatureSharps)
  let rest = parsed[3] ?? ''

  rest = rest.replace(/\/([A-Ga-g])([#b]?)/g, (_match, bassRoot: string, accidental: string) => {
    return `/${normalizeNoteSpellingForKey(`${bassRoot.toUpperCase()}${accidental ?? ''}`, keySignatureSharps)}`
  })

  return `${root}${rest}`
}

export function fileStem(fileName: string): string {
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

function parseArtists(value: string | string[] | null | undefined): string[] {
  if (!value) {
    return []
  }

  let artistStr = ''
  if (Array.isArray(value)) {
    artistStr = value[0] ?? ''
  } else {
    artistStr = value
  }

  if (!artistStr.trim()) {
    return []
  }

  return artistStr
    .split(',')
    .map((artist) => artist.trim())
    .filter((artist) => artist.length > 0)
}

function normalizeCustomMetadataKey(key: string): 'title' | 'artist' | 'capo' | 'comment' | null {
  const normalized = cleanText(key).toLowerCase()
  return CUSTOM_METADATA_ALIASES.get(normalized) ?? null
}

function artistFromPath(path: string): string | null {
  const normalizedPath = String(path).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const segments = normalizedPath.split('/').filter(Boolean)

  if (segments.length <= 1) {
    return null
  }

  const parent = segments[segments.length - 2] ?? ''
  const cleaned = cleanText(parent)

  return cleaned || null
}

export function hasHebrew(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text)
}

function isLikelyChordToken(token: string): boolean {
  return /^[A-G](?:#|b)?(?:m|maj|min|sus|dim|aug|add|no|M|[0-9]|[#b]|\(|\)|\+|-)*(?:\/[A-G](?:#|b)?)?$/i.test(token)
}

function transposeChordToken(token: string, delta: number, tonic: string | null = null, isMinor: boolean = false): string {
  if (!isLikelyChordToken(token)) {
    return token
  }

  if (!delta) {
    return tonic ? normalizeChordSymbolForKey(token, tonic, isMinor) : normalizeChordSymbol(token)
  }

  const chord = Chord.parse(token)

  if (!chord) {
    return tonic ? normalizeChordSymbolForKey(token, tonic, isMinor) : normalizeChordSymbol(token)
  }

  try {
    const transposed = chord.transpose(delta).toString()
    return tonic ? normalizeChordSymbolForKey(transposed, tonic, isMinor) : normalizeChordSymbol(transposed)
  } catch {
    return tonic ? normalizeChordSymbolForKey(token, tonic, isMinor) : normalizeChordSymbol(token)
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

function parseChordedLine(line: string, tonic: string | null = null, isMinor: boolean = false): { lyrics: string; chords: { chord: string; pos: number }[] } {
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

    const rawChord = cleanText(match[1] ?? '')
    const chord = tonic ? normalizeChordSymbolForKey(rawChord, tonic, isMinor) : normalizeChordSymbol(rawChord)
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

function splitChordLineIntoTokens(line: string, tonic: string | null = null, isMinor: boolean = false): ChoproTokenView[] {
  const parsed = parseChordedLine(line, tonic, isMinor)

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

function transposeChoproLine(line: string, delta: number, tonic: string | null = null, isMinor: boolean = false): string {
  return line.replace(/\[([^\]]+)\]/g, (fullMatch, rawChord: string) => {
    const chord = cleanText(rawChord)
    if (!chord) {
      return fullMatch
    }

    return `[${transposeChordToken(chord, delta, tonic, isMinor)}]`
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

function buildChoproBlocks(raw: string, transpose: number, tonic: string | null = null, isMinor: boolean = false): ChoproBlockView[] {
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

    const tokens = splitChordLineIntoTokens(transposeChoproLine(line, transpose, tonic, isMinor), tonic, isMinor)
    blocks.push({
      type: 'line',
      tokens,
      hasLyrics: tokens.some((token) => token.lyric.trim()),
    })
  }

  return blocks
}

function transposeChordText(text: string, delta: number, tonic: string | null = null, isMinor: boolean = false): string {
  // First transpose inline [Chord] markers embedded in lyric text.
  const withInlineChords = text.replace(/\[([^\]]+)\]/g, (fullMatch, rawChord: string) => {
    const chord = cleanText(rawChord)
    if (!chord) {
      return fullMatch
    }

    return `[${transposeChordToken(chord, delta, tonic, isMinor)}]`
  })

  return withInlineChords
    .split(/(\|)/)
    .map((segment) => {
      if (segment === '|') {
        return segment
      }

      return segment.replace(/\S+/g, (token) => {
        if (token.includes('[') && token.includes(']')) {
          return token
        }

        const stripped = token.match(/^([\[({<"']*)(.*?)([\])}>.,;:!?"']*)$/)

        if (!stripped) {
          return token
        }

        const [, prefix, core, suffix] = stripped

        if (!core) {
          return token
        }

        return `${prefix}${transposeChordToken(core, delta, tonic, isMinor)}${suffix}`
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

function extractChordTokens(raw: string): string[] {
  const tokens: string[] = []
  const lines = String(raw).replace(/\r\n?/g, '\n').split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    for (const match of line.matchAll(/\[([^\]]+)\]/g)) {
      const token = normalizeChordSymbol(cleanText(match[1] ?? ''))
      if (token && isLikelyChordToken(token)) {
        tokens.push(token)
      }
    }

    const withoutBrackets = line.replace(/\[[^\]]+\]/g, ' ')

    for (const token of withoutBrackets.split(/[^A-Za-z0-9#/bm+()-]+/g)) {
      const cleaned = normalizeChordSymbol(cleanText(token))
      if (cleaned && isLikelyChordToken(cleaned)) {
        tokens.push(cleaned)
      }
    }
  }

  return tokens
}

function minorTonicFromChord(chord: string): string | null {
  const parsed = chord.match(/^([A-G](?:#|b)?)(.*)$/)
  if (!parsed) {
    return null
  }

  const suffix = (parsed[2] ?? '').toLowerCase().split('/')[0] ?? ''
  if (!/^m(?!aj)|^min/.test(suffix)) {
    return null
  }

  return normalizeNoteSpelling(parsed[1])
}

function inferCapoFromMinorTonic(capo: string | null, raw: string): string | null {
  if (capo) {
    return capo
  }

  const chords = extractChordTokens(raw)
  const tonic = chords.map(minorTonicFromChord).find((value): value is string => Boolean(value))

  if (!tonic) {
    return null
  }

  const tonicSemitone = semitoneFromNote(tonic)
  if (tonicSemitone === null) {
    return null
  }

  const targetCandidates = [
    { tonic: 'A', priority: 0 },
    { tonic: 'E', priority: 1 },
  ]

  const capoOptions = targetCandidates
    .map(({ tonic: target, priority }) => {
      const targetSemitone = semitoneFromNote(target)
      if (targetSemitone === null) {
        return null
      }

      const capoValue = (tonicSemitone - targetSemitone + 12) % 12
      return { capoValue, priority }
    })
    .filter((value): value is { capoValue: number; priority: number } => Boolean(value))
    .sort((left, right) => {
      const leftPenalty = left.capoValue > 7 ? 100 + left.capoValue : left.capoValue
      const rightPenalty = right.capoValue > 7 ? 100 + right.capoValue : right.capoValue

      if (leftPenalty !== rightPenalty) {
        return leftPenalty - rightPenalty
      }

      return left.priority - right.priority
    })

  const best = capoOptions[0]
  if (!best || best.capoValue <= 0) {
    return null
  }

  return String(best.capoValue)
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
      const key = cleanText(tagMatch[1] ?? '')
      const value = cleanText(tagMatch[2] ?? '') || null
      const normalizedKey = key.toLowerCase()
      const metadataKey = normalizeCustomMetadataKey(key)

      if (!value && key) {
        const sectionLabel = CHORD_TAGS.has(normalizedKey) ? formatSectionLabel(normalizedKey) : key
        currentSection = { label: sectionLabel, lines: [] }
        sections.push(currentSection)
        continue
      }

      if (value && /^[xX0-9\-]+$/.test(value) && isLikelyChordToken(key)) {
        fingerings.push({ chord: normalizeChordSymbol(key), fingering: value })
        continue
      }

      if (value) {
        metadata.set(metadataKey ?? normalizedKey, value)
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
  const artists = parseArtists(metadata.get('artist'))
  const capo = metadata.get('capo') ?? null
  const comment = metadata.get('comment') ?? null

  return {
    title,
    artists,
    capo,
    comment,
    rtl: hasHebrew(raw) || hasHebrew(title) || hasHebrew(artists.join(', ')),
  }
}

function summarizeChoproSong(raw: string, fileName: string) {
  const parser = new ChordProParser()
  const song = parser.parse(sanitizeChoproForParser(raw))

  return {
    title: normalizeSingleValue(song.getSingleMetadataValue('title')) ?? titleFromStem(fileName),
    artists: parseArtists(song.getSingleMetadataValue('artist')),
    capo: normalizeSingleValue(song.getSingleMetadataValue('capo')),
    comment: normalizeSingleValue(song.getSingleMetadataValue('comment')),
    rtl:
      hasHebrew(raw) ||
      hasHebrew(normalizeSingleValue(song.getSingleMetadataValue('title')) ?? '') ||
      hasHebrew(parseArtists(song.getSingleMetadataValue('artist')).join(', ')),
  }
}

export function buildEntry(fileName: string, raw: string, source: SongSource, path: string): SongEntry {
  const format: SongFormat = fileName.endsWith('.chopro') ? 'chopro' : 'chords'
  const summary = format === 'chopro' ? summarizeChoproSong(raw, fileName) : summarizeCustomSong(raw, fileName)
  const fallbackArtist = format === 'chords' ? artistFromPath(path) : null
  const artists = summary.artists.length > 0 ? summary.artists : (fallbackArtist ? [fallbackArtist] : [])

  return {
    path,
    name: fileName,
    title: summary.title,
    artists,
    format,
    raw,
    source,
    rtl: summary.rtl,
  }
}

function renderChoproSong(entry: SongEntry, transpose: number): SongView {
  const parser = new ChordProParser()
  const parsed = parser.parse(sanitizeChoproForParser(entry.raw))
  const metadataCapo = normalizeSingleValue(parsed.getSingleMetadataValue('capo'))

  const chords = extractChordTokens(entry.raw)
  const detectedTonic = chords.map(minorTonicFromChord).find((value): value is string => Boolean(value)) ?? null
  const artists = parseArtists(parsed.getSingleMetadataValue('artist')) || entry.artists

  return {
    title: normalizeSingleValue(parsed.getSingleMetadataValue('title')) ?? entry.title,
    artists,
    capo: inferCapoFromMinorTonic(metadataCapo, entry.raw),
    comment: normalizeSingleValue(parsed.getSingleMetadataValue('comment')),
    rtl:
      entry.rtl ||
      hasHebrew(parsed.getSingleMetadataValue('title') ?? '') ||
      hasHebrew(artists.join(', ')),
    detectedTonic,
    detectedIsMinor: !!detectedTonic,
    choproBlocks: buildChoproBlocks(entry.raw, transpose, detectedTonic, !!detectedTonic),
    format: entry.format,
    source: entry.source,
  }
}

function renderCustomSong(entry: SongEntry, transpose: number): SongView {
  const { metadata, fingerings, sections } = parseCustomMetadata(entry.raw)

  const chords = extractChordTokens(entry.raw)
  const detectedTonic = chords.map(minorTonicFromChord).find((value): value is string => Boolean(value)) ?? null
  const isMinor = !!detectedTonic

  const transposedSections = sections.map((section) => ({
    label: section.label,
    lines: section.lines.map((line) => transposeChordText(line, transpose, detectedTonic, isMinor)),
  }))

  const transposedFingerings = fingerings.map((definition) => ({
    chord: transposeChordToken(definition.chord, transpose, detectedTonic, isMinor),
    fingering: definition.fingering,
  }))

  const artists = parseArtists(metadata.get('artist')) || entry.artists

  return {
    title: metadata.get('title')?.trim() || entry.title,
    artists,
    capo: inferCapoFromMinorTonic(metadata.get('capo') ?? null, entry.raw),
    comment: metadata.get('comment') ?? null,
    rtl: entry.rtl,
    detectedTonic,
    detectedIsMinor: isMinor,
    sections: transposedSections,
    fingerings: transposedFingerings,
    format: entry.format,
    source: entry.source,
  }
}

export function buildSongView(entry: SongEntry, transpose: number): SongView {
  return entry.format === 'chopro' ? renderChoproSong(entry, transpose) : renderCustomSong(entry, transpose)
}
