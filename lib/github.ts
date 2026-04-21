import { buildEntry, type SongEntry } from './songbook-core'
import type { RepoSettings } from './storage'

interface GithubTreeEntry {
  path: string
  type: 'blob' | 'tree'
  sha: string
}

interface GithubTreeResponse {
  tree?: GithubTreeEntry[]
  truncated?: boolean
}

interface GithubBlobResponse {
  content?: string
  encoding?: string
}

function splitRepository(repository: string): { owner: string; name: string } {
  const parts = repository.split('/').map((part) => part.trim()).filter(Boolean)
  if (parts.length !== 2) {
    throw new Error('Repository must be in owner/repo format')
  }

  return { owner: parts[0], name: parts[1] }
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function decodeBase64Unicode(value: string): string {
  const normalized = value.replace(/\n/g, '')
  const binary = atob(normalized)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export async function pullSongsFromGithub(
  settings: RepoSettings,
  onProgress?: (done: number, total: number) => void,
): Promise<SongEntry[]> {
  const { owner, name } = splitRepository(settings.repository)
  const chordsPath = settings.chordsPath.trim().replace(/^\/+|\/+$/g, '')
  const treeResponse = await fetch(
    `https://api.github.com/repos/${owner}/${name}/git/trees/${encodeURIComponent(settings.branch)}?recursive=1`,
    {
      headers: authHeaders(settings.token),
    },
  )

  if (!treeResponse.ok) {
    throw new Error(`Failed to load repository tree (${treeResponse.status})`)
  }

  const treePayload = (await treeResponse.json()) as GithubTreeResponse

  if (treePayload.truncated) {
    throw new Error('Repository tree is too large for recursive API response. Narrow the chord path.')
  }

  const files = (treePayload.tree ?? [])
    .filter((item) => item.type === 'blob')
    .filter((item) => (chordsPath ? item.path.startsWith(`${chordsPath}/`) : true))
    .filter((item) => /\.(chopro|chords)$/i.test(item.path))
    .sort((left, right) => left.path.localeCompare(right.path))

  const entries: SongEntry[] = []

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const blobResponse = await fetch(
      `https://api.github.com/repos/${owner}/${name}/git/blobs/${encodeURIComponent(file.sha)}`,
      {
        headers: authHeaders(settings.token),
      },
    )

    if (!blobResponse.ok) {
      throw new Error(`Failed to pull ${file.path} (${blobResponse.status})`)
    }

    const blobPayload = (await blobResponse.json()) as GithubBlobResponse
    const raw = decodeBase64Unicode(blobPayload.content ?? '')
    const fileName = file.path.split('/').pop() ?? file.path
    entries.push(buildEntry(fileName, raw, 'github', file.path))

    if (onProgress) {
      onProgress(index + 1, files.length)
    }
  }

  return entries
}
