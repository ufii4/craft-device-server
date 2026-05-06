import { editImage } from './edit.ts'
import { searchImages } from './search.ts'
import type { EditImagesInput, SearchImagesInput } from '../mcp/schemas.ts'
import type { ImageEditResult, ImageSearchResultSet } from './types.ts'

export interface ImagesServiceOptions {
  openaiApiKey?: string
  pexelsApiKey?: string
  fetchImpl?: typeof fetch
}

export interface ImagesService {
  search(input: SearchImagesInput): Promise<ImageSearchResultSet>
  edit(input: EditImagesInput): Promise<ImageEditResult>
}

export function createImagesService(options: ImagesServiceOptions): ImagesService {
  return {
    async search(input) {
      return await searchImages(input, {
        apiKey: options.pexelsApiKey,
        fetchImpl: options.fetchImpl,
      })
    },
    async edit(input) {
      return await editImage(input, {
        apiKey: options.openaiApiKey,
        fetchImpl: options.fetchImpl,
      })
    },
  }
}
