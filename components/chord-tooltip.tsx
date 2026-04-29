'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import { ChordStyle, Orientation, SVGuitarChord, type Chord as SVGuitarChordData, type Finger } from 'svguitar'
import { normalizeChordSymbol, normalizeChordSymbolForKey } from '@/lib/songbook-core'

type ChordTooltipProps = {
  chord: string
  fingering?: string | null
  className?: string
  as?: 'span' | 'div'
  tonic?: string | null
  isMinor?: boolean
  children: ReactNode
}

type FingeringDiagram = {
  fingers: Finger[]
  barres: SVGuitarChordData['barres']
  position?: number
  frets: number
}

type FingeringOption = {
  id: string
  label: string
  diagram: FingeringDiagram
}

type ChordsDbPosition = {
  frets: number[]
  fingers?: number[]
  baseFret?: number
  barres?: number[]
}

type ChordsDbChord = {
  suffix: string
  positions: ChordsDbPosition[]
}

type ChordsDbRoot = {
  keys?: string[]
  chords?: Record<string, ChordsDbChord[]>
}

const CHORDS_DB_URL = 'https://raw.githubusercontent.com/tombatossals/chords-db/refs/heads/master/lib/guitar.json'
const CHORDS_DB_URL_CANDIDATES = [
  CHORDS_DB_URL,
  'https://raw.githubusercontent.com/tombatossals/chords-db/master/lib/guitar.json',
  'https://raw.githubusercontent.com/tombatossals/chords-db/main/lib/guitar.json',
]
const SHARP_TO_FLAT: Record<string, string> = {
  'A#': 'Bb',
  'D#': 'Eb',
  'G#': 'Ab',
}
const chordOptionsCache = new Map<string, FingeringOption[]>()
let chordsDbPromise: Promise<ChordsDbRoot | null> | null = null
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

function normalizeDbNote(note: string): string {
  const cleaned = note.trim()
  if (!cleaned) {
    return cleaned
  }

  const upper = `${cleaned[0].toUpperCase()}${cleaned.slice(1)}`
  return SHARP_TO_FLAT[upper] ?? upper
}

function normalizeSuffixCandidate(suffix: string): string {
  if (!suffix) {
    return 'major'
  }

  if (suffix === 'm' || suffix === 'min') {
    return 'minor'
  }

  if (suffix === 'maj') {
    return 'major'
  }

  return suffix
}

function chordToDbKeyAndSuffix(chord: string): { key: string; suffix: string } | null {
  const cleaned = normalizeChordSymbol(chord).trim().replace(/\s+/g, '')
  const parsed = cleaned.match(/^([A-Ga-g])([#b]?)(.*)$/)

  if (!parsed) {
    return null
  }

  const base = `${parsed[1].toUpperCase()}${parsed[2] ?? ''}`
  const rest = parsed[3] ?? ''
  const slashIndex = rest.indexOf('/')
  const rawSuffix = slashIndex >= 0 ? rest.slice(0, slashIndex) : rest
  const rawBass = slashIndex >= 0 ? rest.slice(slashIndex + 1) : ''
  const suffix = normalizeSuffixCandidate(rawSuffix)
  // If the chord has a custom bass (/B), ignore the bass when resolving
  // fingering positions — show the fingering for the main chord instead.
  // e.g., Gm/B should resolve positions for Gm.

  return {
    key: normalizeDbNote(base),
    suffix,
  }
}

function semitoneFromNote(note: string): number | null {
  return NOTE_TO_SEMITONE[note] ?? null
}

function parseSuffixForGuessing(suffix: string): 'major' | 'minor' | 'dominant7' | 'minor7' | 'major7' | 'sus4' {
  const plain = suffix.toLowerCase().split('/')[0] ?? ''

  if (plain.startsWith('maj7')) {
    return 'major7'
  }

  if (plain.startsWith('m7') || plain.startsWith('min7')) {
    return 'minor7'
  }

  if (plain.startsWith('sus4')) {
    return 'sus4'
  }

  if (plain === '7' || plain.startsWith('7')) {
    return 'dominant7'
  }

  if (plain.startsWith('m') || plain.startsWith('min')) {
    return 'minor'
  }

  return 'major'
}

function createDiagramFromFrets(frets: number[], barre?: { fret: number; fromString: number; toString: number }): FingeringDiagram | null {
  if (frets.length !== 6) {
    return null
  }

  const fingers: Finger[] = []
  const fretted: number[] = []

  for (let index = 0; index < frets.length; index += 1) {
    const stringNumber = 6 - index
    const fret = frets[index] ?? -1

    if (fret < 0) {
      fingers.push([stringNumber, 'x'])
      continue
    }

    fingers.push([stringNumber, fret, fret === 0 ? '0' : String(fret)])
    if (fret > 0) {
      fretted.push(fret)
    }
  }

  const minFret = fretted.length ? Math.min(...fretted) : 1
  const maxFret = fretted.length ? Math.max(...fretted) : 1

  return {
    fingers,
    barres: barre
      ? [
          {
            fromString: barre.fromString,
            toString: barre.toString,
            fret: barre.fret,
            text: '1',
          },
        ]
      : [],
    position: minFret > 1 ? minFret : undefined,
    frets: Math.max(4, maxFret - minFret + 1),
  }
}

function transposeShape(shape: number[], shift: number): number[] {
  return shape.map((fret) => {
    if (fret < 0) {
      return -1
    }

    return fret + shift
  })
}

function guessChordDiagrams(chord: string): FingeringOption[] {
  const parsed = chordToDbKeyAndSuffix(chord)
  if (!parsed) {
    return []
  }

  const rootSemitone = semitoneFromNote(parsed.key)
  if (rootSemitone === null) {
    return []
  }

  const quality = parseSuffixForGuessing(parsed.suffix)

  const eShapes: Record<string, number[]> = {
    major: [0, 2, 2, 1, 0, 0],
    minor: [0, 2, 2, 0, 0, 0],
    dominant7: [0, 2, 0, 1, 0, 0],
    minor7: [0, 2, 0, 0, 0, 0],
    major7: [0, 2, 1, 1, 0, 0],
    sus4: [0, 2, 2, 2, 0, 0],
  }

  const aShapes: Record<string, number[]> = {
    major: [-1, 0, 2, 2, 2, 0],
    minor: [-1, 0, 2, 2, 1, 0],
    dominant7: [-1, 0, 2, 0, 2, 0],
    minor7: [-1, 0, 2, 0, 1, 0],
    major7: [-1, 0, 2, 1, 2, 0],
    sus4: [-1, 0, 2, 2, 3, 0],
  }

  const eShift = rootSemitone
  const aShift = (rootSemitone - 9 + 12) % 12
  const options: FingeringOption[] = []

  if (eShift > 0 || (parsed.key === 'E' && quality !== 'major')) {
    const eDiagram = createDiagramFromFrets(
      transposeShape(eShapes[quality], eShift),
      eShift > 0
        ? {
            fret: eShift,
            fromString: 6,
            toString: 1,
          }
        : undefined,
    )

    if (eDiagram) {
      options.push({
        id: `${chord}-guess-e`,
        label: eShift > 0 ? `(${eShift})` : '(?)',
        diagram: eDiagram,
      })
    }
  }

  if (aShift > 0 || parsed.key === 'A') {
    const aDiagram = createDiagramFromFrets(
      transposeShape(aShapes[quality], aShift),
      aShift > 0
        ? {
            fret: aShift,
            fromString: 5,
            toString: 1,
          }
        : undefined,
    )

    if (aDiagram) {
      options.push({
        id: `${chord}-guess-a`,
        label: aShift > 0 ? `(${aShift})` : '(?)',
        diagram: aDiagram,
      })
    }
  }

  return options.slice(0, 4)
}

function positionToDiagram(position: ChordsDbPosition): FingeringDiagram | null {
  const frets = position.frets ?? []

  if (frets.length !== 6) {
    return null
  }

  const fingers: Finger[] = []
  const usedFrets = new Set<number>()

  for (let index = 0; index < frets.length; index += 1) {
    const stringNumber = 6 - index
    const fret = frets[index] ?? -1
    const finger = position.fingers?.[index] ?? 0

    if (fret < 0) {
      fingers.push([stringNumber, 'x'])
      continue
    }

    const label = finger > 0 ? String(finger) : fret === 0 ? '0' : String(fret)
    fingers.push([stringNumber, fret, label])

    if (fret > 0) {
      usedFrets.add(fret)
    }
  }

  const minFret = usedFrets.size ? Math.min(...usedFrets) : 1
  const maxFret = usedFrets.size ? Math.max(...usedFrets) : 1
  const baseFret = position.baseFret && position.baseFret > 1 ? position.baseFret : undefined
  const barres = (position.barres ?? [])
    .map((fret) => ({
      fromString: 6,
      toString: 1,
      fret,
      text: '1',
    }))

  return {
    fingers,
    barres,
    position: baseFret,
    frets: Math.max(4, maxFret - minFret + 1),
  }
}

async function loadChordsDbFromCache(): Promise<ChordsDbRoot | null> {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return null
  }

  if (!chordsDbPromise) {
    chordsDbPromise = (async () => {
      try {
        let cachedResponse: Response | undefined

        for (const candidate of CHORDS_DB_URL_CANDIDATES) {
          const match = await window.caches.match(candidate, { ignoreSearch: true })
          if (match) {
            cachedResponse = match
            break
          }
        }

        if (!cachedResponse) {
          const cacheNames = await window.caches.keys()

          for (const cacheName of cacheNames) {
            const cache = await window.caches.open(cacheName)
            const requests = await cache.keys()
            const found = requests.find((request) => {
              const url = request.url.toLowerCase()
              return url.includes('raw.githubusercontent.com/tombatossals/chords-db') && url.endsWith('/lib/guitar.json')
            })

            if (!found) {
              continue
            }

            const match = await cache.match(found, { ignoreSearch: true })
            if (match) {
              cachedResponse = match
              break
            }
          }
        }

        if (!cachedResponse) {
          // Prime the browser HTTP cache once if the payload was never cached before.
          try {
            const response = await fetch(CHORDS_DB_URL, { cache: 'force-cache' })
            if (response.ok) {
              cachedResponse = response
            }
          } catch {
            return null
          }
        }

        if (!cachedResponse) {
          return null
        }

        return (await cachedResponse.json()) as ChordsDbRoot
      } catch {
        return null
      }
    })()
  }

  return chordsDbPromise
}

async function resolveDiagramOptions(chord: string): Promise<FingeringOption[]> {
  const normalizedChord = normalizeChordSymbol(chord)
  const cached = chordOptionsCache.get(normalizedChord)
  if (cached) {
    return cached
  }

  const options: FingeringOption[] = []
  const token = chordToDbKeyAndSuffix(normalizedChord)

  if (token) {
    const db = await loadChordsDbFromCache()
    const root = db?.chords?.[token.key] ?? []
    const matched = root.find((entry) => entry.suffix.toLowerCase() === token.suffix.toLowerCase())

    if (matched?.positions?.length) {
      matched.positions.slice(0, 4).forEach((position, index) => {
        const diagram = positionToDiagram(position)
        if (diagram) {
          options.push({
            id: `${normalizedChord}-db-${index}`,
            label: `${index + 1}`,
            diagram,
          })
        }
      })
    }
  }

  if (!options.length) {
    options.push(...guessChordDiagrams(normalizedChord))
  }

  chordOptionsCache.set(normalizedChord, options)

  return options
}

function parseFingeringDiagram(fingering: string): FingeringDiagram | null {
  const trimmed = fingering.trim()

  if (!trimmed) {
    return null
  }

  const tokens = trimmed.includes(' ') ? trimmed.split(/\s+/).filter(Boolean) : trimmed.length === 6 ? trimmed.split('') : []

  if (tokens.length !== 6) {
    return null
  }

  const fingers: Finger[] = []
  const frettedStrings: number[] = []

  for (const [index, token] of tokens.entries()) {
    const stringNumber = 6 - index

    if (/^[xX]$/.test(token)) {
      fingers.push([stringNumber, 'x'])
      continue
    }

    if (!/^\d+$/.test(token)) {
      return null
    }

    const fret = Number.parseInt(token, 10)
    fingers.push([stringNumber, fret, fret === 0 ? '0' : String(fret)])

    if (fret > 0) {
      frettedStrings.push(fret)
    }
  }

  const minFret = frettedStrings.length ? Math.min(...frettedStrings) : 1
  const maxFret = frettedStrings.length ? Math.max(...frettedStrings) : 1

  return {
    fingers,
    barres: [],
    position: minFret > 1 ? minFret : undefined,
    frets: Math.max(4, maxFret - minFret + 1),
  }
}

export function ChordTooltip({ chord, fingering, className, as = 'span', tonic, isMinor = false, children }: ChordTooltipProps) {
  const [open, setOpen] = useState(false)
  const normalizedChord = useMemo(() => normalizeChordSymbolForKey(chord, tonic ?? null, isMinor), [chord, tonic, isMinor])
  const inlineDiagram = useMemo(() => (fingering ? parseFingeringDiagram(fingering) : null), [fingering])
  const [options, setOptions] = useState<FingeringOption[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const diagram = inlineDiagram ?? options[activeIndex]?.diagram ?? null
  const diagramRef = useRef<HTMLDivElement | null>(null)
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top',
    middleware: [offset(12), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  const click = useClick(context, {
    event: 'click',
    toggle: false,
  })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role])

  useEffect(() => {
    if (!open || inlineDiagram) {
      if (!open) {
        setActiveIndex(0)
      }
      return
    }

    let active = true
    setOptions([])
    setActiveIndex(0)

    void resolveDiagramOptions(normalizedChord).then((resolved) => {
      if (active) {
        setOptions(resolved)
      }
    })

    return () => {
      active = false
    }
  }, [inlineDiagram, normalizedChord, open])

  useEffect(() => {
    const panel = diagramRef.current

    if (!panel || !diagram || !open) {
      return
    }

    panel.replaceChildren()

    const root = window.getComputedStyle(document.documentElement)
    const isDarkTheme = document.documentElement.classList.contains('dark')
    // const diagramInk = isDarkTheme ? '#000000' : '#ffffff'
    const diagramInk = '#000000';
    const chordColor = root.getPropertyValue('--chord').trim() || '#8c3d69'

    new SVGuitarChord(panel)
      .configure({
        orientation: Orientation.vertical,
        style: ChordStyle.normal,
        strings: 6,
        frets: diagram.frets,
        position: diagram.position,
        tuning: ['', '', '', '', '', ''],
        color: diagramInk,
        titleColor: diagramInk,
        stringColor: diagramInk,
        fretColor: diagramInk,
        fretLabelColor: diagramInk,
        tuningsColor: diagramInk,
        fingerColor: chordColor,
        fingerTextColor: '#ffffff',
        fingerStrokeColor: chordColor,
        backgroundColor: 'none',
        titleFontSize: 24,
        fretLabelFontSize: 18,
        tuningsFontSize: 16,
        fingerTextSize: 16,
        fingerSize: 0.72,
        fretSize: 1.2,
        sidePadding: 0.2,
        titleBottomMargin: 0,
        svgTitle: `${normalizedChord} chord diagram`,
      })
      .chord({
        fingers: diagram.fingers,
        barres: diagram.barres,
        position: diagram.position,
        title: '',
      })
      .draw()
  }, [diagram, normalizedChord, open])

  const Trigger = as
  const triggerClassName = [
    className,
    open ? 'chord-tooltip-open' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <Trigger ref={refs.setReference} className={triggerClassName} {...getReferenceProps()}>
        {children}
      </Trigger>
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="chord-tooltip-panel"
            {...getFloatingProps()}
          >
            {diagram ? (
              <>
                <div ref={diagramRef} className="chord-tooltip-diagram" />
                {!inlineDiagram && options.length > 1 ? (
                  <div className="chord-tooltip-options" role="group" aria-label="Fingering options">
                    {options.map((option, index) => (
                      <button
                        key={option.id}
                        type="button"
                        className={index === activeIndex ? 'chord-tooltip-option active' : 'chord-tooltip-option'}
                        onClick={() => setActiveIndex(index)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="chord-tooltip-fallback">
                <strong>{normalizedChord}</strong>
                <span>No fingering found</span>
              </div>
            )}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  )
}