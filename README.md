# Songbook

Songbook is a Next.js + Tailwind + HeroUI web app for reading private chord files from GitHub and caching them offline in the browser.

It supports two formats in your configured chord path:

- `.chopro` for lyric sheets rendered with ChordSheetJS
- `.chords` for the custom section-based chord-only format

## Features

- Private GitHub repository pull (read-only PAT)
- Offline browser cache (IndexedDB)
- Manual pull to refresh local library
- Live transposition
- Adjustable font size
- Miriam Libre typography
- RTL support for Hebrew `.chopro` files

## Development

```bash
npm install
npm run dev
```

## First Run Setup

1. Open the app.
2. Enter your private repository as `owner/repo`.
3. Enter branch and chord path (default: `chords`).
4. Enter a fine-grained GitHub token with read-only repository contents access.
5. Save settings, then click `Pull changes`.

Songs are stored in browser IndexedDB for offline reading.

## GitHub Pages

The included workflow deploys the site from `main` and skips pushes that only change files under `chords/`.

This project uses Next.js static export and publishes the `out/` directory.
