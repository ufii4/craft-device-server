import type { ImageSearchResultSet, NormalizedImageSearchResult } from './types.ts'

const PEXELS_API_BASE = 'https://api.pexels.com/v1'

interface PexelsPhoto {
  id: number
  width: number
  height: number
  alt: string | null
  avg_color: string | null
  photographer: string
  url: string
  src: {
    medium: string
  }
}

interface PexelsSearchResponse {
  page: number
  per_page: number
  total_results: number
  photos: PexelsPhoto[]
}

export interface PexelsSearchParams {
  query: string
  orientation?: 'landscape' | 'portrait' | 'square'
  size?: 'large' | 'medium' | 'small'
  color?: string
  locale?: string
  page?: number
  per_page?: number
}

export interface PexelsClientOptions {
  apiKey?: string
  fetchImpl?: typeof fetch
}

function getApiKey(options: PexelsClientOptions): string {
  if (!options.apiKey) {
    throw new Error(
      'PEXELS_API_KEY is not set. Add it to the device server environment to enable images.search.',
    )
  }

  return options.apiKey
}

function normalizePhoto(photo: PexelsPhoto): NormalizedImageSearchResult {
  return {
    provider: 'pexels',
    id: String(photo.id),
    ref: `pexels:${photo.id}`,
    alt: photo.alt,
    width: photo.width,
    height: photo.height,
    photographer: photo.photographer,
    attributionUrl: photo.url,
    previewUrl: photo.src.medium,
    avgColor: photo.avg_color,
  }
}

export async function searchPexelsPhotos(
  params: PexelsSearchParams,
  options: PexelsClientOptions = {},
): Promise<ImageSearchResultSet> {
  const url = new URL('search', `${PEXELS_API_BASE}/`)
  const fetchImpl = options.fetchImpl ?? fetch

  for (const [key, value] of Object.entries(params)) {
    if (value != null) {
      url.searchParams.set(key, String(value))
    }
  }

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      Authorization: getApiKey(options),
    },
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      detail
        ? `Pexels API returned ${response.status}: ${detail}`
        : `Pexels API returned ${response.status} ${response.statusText}`,
    )
  }

  const data = await response.json() as PexelsSearchResponse

  return {
    method: 'search',
    provider: 'pexels',
    query: params.query,
    page: data.page,
    perPage: data.per_page,
    totalResults: data.total_results,
    results: data.photos.map(normalizePhoto),
  }
}
