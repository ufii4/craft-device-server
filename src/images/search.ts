import { searchPexelsPhotos, type PexelsClientOptions } from './pexels.ts'
import type { ImageSearchResultSet } from './types.ts'
import type { SearchImagesInput } from '../mcp/schemas.ts'

export interface ImageSearchServiceOptions extends PexelsClientOptions {}

export async function searchImages(
  input: SearchImagesInput,
  options: ImageSearchServiceOptions,
): Promise<ImageSearchResultSet> {
  if (input.provider !== 'pexels') {
    throw new Error(`Unsupported image search provider: ${input.provider}`)
  }

  return await searchPexelsPhotos({
    query: input.query,
    orientation: input.orientation,
    size: input.size,
    color: input.color,
    locale: input.locale,
    page: input.page,
    per_page: input.perPage,
  }, options)
}
