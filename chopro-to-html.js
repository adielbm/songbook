
const ZW_REGEX = /[\u200B-\u200F\uFEFF]/g

function cleanText(value) {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(ZW_REGEX, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim()
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function parseChordedLine(line) {
  const pattern = /\[([^\]]+)\]/g
  let cursor = 0
  let lyrics = ''
  const chords = []

  for (const match of line.matchAll(pattern)) {
    const start = match.index || 0
    const end = start + match[0].length
    const before = line.slice(cursor, start)

    if (before) {
      lyrics += before
    }

    const chord = cleanText(match[1] || '')
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

function splitChordLineIntoTokens(line) {
  const parsed = parseChordedLine(line)

  if (parsed.chords.length === 0) {
    return parsed.lyrics.trim() ? [{ lyric: parsed.lyrics }] : []
  }

  const tokens = []

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

function renderChordedLine(line) {
  const tokens = splitChordLineIntoTokens(line)

  if (tokens.length === 0) {
    return '<div class="line-block empty" dir="rtl"><div class="phrase-row"></div></div>'
  }

  const tokenMarkup = tokens
    .map((token) => {
      const chordMarkup = token.chord
        ? `<div class="phrase-chord">${escapeHtml(token.chord)}</div>`
        : '<div class="phrase-chord empty">&nbsp;</div>'

      const lyricMarkup = token.lyric
        ? `<div class="phrase-lyric">${escapeHtml(token.lyric)}</div>`
        : '<div class="phrase-lyric empty">&nbsp;</div>'

      return `<div class="phrase-block">${chordMarkup}${lyricMarkup}</div>`
    })
    .join('')

  const hasLyricTokens = tokens.some((token) => token.lyric.trim())

  return [
    '<div class="line-block" dir="rtl">',
    `<div class="phrase-row${hasLyricTokens ? '' : ' no-lyrics'}">${tokenMarkup}</div>`,
    '</div>',
  ].join('')
}

function chordProToHtml(chopro) {
  const lines = String(chopro).replace(/\r\n?/g, '\n').split('\n')
  const rendered = []

  for (const raw of lines) {
    const line = raw.trimEnd()

    const sectionMatch = line.match(/^\{\s*(?:c\s*:\s*)?(.*?)\s*\}$/i)
    if (sectionMatch) {
      const section = cleanText(sectionMatch[1] || '')
      if (section) {
        rendered.push(`<h3 class="section">${escapeHtml(section)}</h3>`)
      }
      continue
    }

    if (!line.trim()) {
      rendered.push('<div class="spacer"></div>')
      continue
    }

    rendered.push(renderChordedLine(line))
  }

  return ['<div class="song-html" dir="rtl">', ...rendered, '</div>'].join('\n')
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { chordProToHtml }
}

if (typeof window !== 'undefined') {
  window.chordProToHtml = chordProToHtml
}
