export type ImageProvider = 'pexels'

export interface NormalizedImageSearchResult {
  provider: ImageProvider
  id: string
  ref: string
  alt: string | null
  width: number
  height: number
  photographer: string
  attributionUrl: string
  previewUrl: string
  avgColor: string | null
}

export interface ImageSearchResultSet {
  method: 'search'
  provider: ImageProvider
  query: string
  page: number
  perPage: number
  totalResults: number
  results: NormalizedImageSearchResult[]
}

export interface ImageEditResult {
  method: 'edit'
  model: string
  outputFormat: 'png' | 'jpeg' | 'webp'
  outputPaths: string[]
  requestedCount: number
  returnedCount: number
  resolvedSize: string
  requestId?: string
  revisedPrompt?: string
  quality?: string
  background?: string
}
