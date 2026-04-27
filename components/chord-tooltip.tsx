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

type ChordTooltipProps = {
  chord: string
  fingering?: string | null
  className?: string
  as?: 'span' | 'div'
  children: ReactNode
}

type FingeringDiagram = {
  fingers: Finger[]
  barres: SVGuitarChordData['barres']
  position?: number
  frets: number
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
const chordDiagramCache = new Map<string, FingeringDiagram | null>()
let chordsDbPromise: Promise<ChordsDbRoot | null> | null = null

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
  const cleaned = chord.trim().replace(/\s+/g, '')
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

  if (rawBass) {
    return {
      key: normalizeDbNote(base),
      suffix: `${suffix}/${normalizeDbNote(rawBass)}`,
    }
  }

  return {
    key: normalizeDbNote(base),
    suffix,
  }
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

async function resolveDiagramFromCachedDb(chord: string): Promise<FingeringDiagram | null> {
  const cached = chordDiagramCache.get(chord)
  if (cached !== undefined) {
    return cached
  }

  const token = chordToDbKeyAndSuffix(chord)
  if (!token) {
    chordDiagramCache.set(chord, null)
    return null
  }

  const db = await loadChordsDbFromCache()
  const root = db?.chords?.[token.key] ?? []
  const matched = root.find((entry) => entry.suffix.toLowerCase() === token.suffix.toLowerCase())
  const diagram = matched?.positions?.[0] ? positionToDiagram(matched.positions[0]) : null

  chordDiagramCache.set(chord, diagram)
  return diagram
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

export function ChordTooltip({ chord, fingering, className, as = 'span', children }: ChordTooltipProps) {
  const [open, setOpen] = useState(false)
  const inlineDiagram = useMemo(() => (fingering ? parseFingeringDiagram(fingering) : null), [fingering])
  const [cachedDiagram, setCachedDiagram] = useState<FingeringDiagram | null>(null)
  const diagram = inlineDiagram ?? cachedDiagram
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
      return
    }

    let active = true
    setCachedDiagram(null)

    void resolveDiagramFromCachedDb(chord).then((resolved) => {
      if (active) {
        setCachedDiagram(resolved)
      }
    })

    return () => {
      active = false
    }
  }, [chord, inlineDiagram, open])

  useEffect(() => {
    const panel = diagramRef.current

    if (!panel || !diagram || !open) {
      return
    }

    panel.replaceChildren()

    const root = window.getComputedStyle(document.documentElement)
    const isDarkTheme = document.documentElement.classList.contains('dark')
    const diagramInk = isDarkTheme ? '#000000' : '#ffffff'
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
        svgTitle: `${chord} chord diagram`,
      })
      .chord({
        fingers: diagram.fingers,
        barres: diagram.barres,
        position: diagram.position,
        title: '',
      })
      .draw()
  }, [chord, diagram, open])

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
              <div ref={diagramRef} className="chord-tooltip-diagram" />
            ) : (
              <div className="chord-tooltip-fallback">
                <strong>{chord}</strong>
                <span>No fingering in cache</span>
              </div>
            )}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  )
}