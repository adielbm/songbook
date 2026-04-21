import type { SongEntry } from './songbook-core'

const hebrewChopro = `{title: שיר לדוגמה}
{artist: Songbook}
{capo: 1}

{start_of_verse}
[Em]שלום, [Am]שלום, [G]נשיר [D]יחד
[Em]בלב [Am]פתוח, [G]באור [D]חדר
{end_of_verse}

{start_of_chorus}
[C]עוד שורה [G]קטנה
[Am]עם [Em]הרמוניה [D]יפה
{end_of_chorus}
`

const simpleCustom = `{title: Some Title}
{artist: Some Artist}
{capo: 1}
{Em:010000}
{comment: Comment...}

{verse}
Em | Am | G | Am (2)
Em Am | B Em

{chorus}
Em | Am | Em
Em | Am | D (C B) | Am | Em
`

export const sampleSongs: SongEntry[] = [
  {
    path: 'chords/shalom-sample.chopro',
    name: 'shalom-sample.chopro',
    title: 'שיר לדוגמה',
    artist: 'Songbook',
    format: 'chopro',
    raw: hebrewChopro,
    source: 'sample',
    rtl: true,
  },
  {
    path: 'chords/some-title.chords',
    name: 'some-title.chords',
    title: 'Some Title',
    artist: 'Some Artist',
    format: 'chords',
    raw: simpleCustom,
    source: 'sample',
    rtl: false,
  },
]
