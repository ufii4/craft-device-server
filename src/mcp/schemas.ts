import { z } from 'zod'

const searchSchema = z.object({
  method: z.literal('search').describe('Search for stock images'),
  query: z.string().min(1).describe('Search query'),
  provider: z.enum(['pexels']).default('pexels').describe('Image provider to query'),
  orientation: z.enum(['landscape', 'portrait', 'square']).optional().describe('Preferred photo orientation'),
  size: z.enum(['large', 'medium', 'small']).optional().describe('Provider-defined image size filter'),
  color: z.string().optional().describe('Preferred dominant color'),
  locale: z.string().optional().describe('Search locale'),
  page: z.number().int().positive().optional().describe('Result page number'),
  perPage: z.number().int().min(1).max(80).optional().describe('Results per page'),
})

const editSchema = z.object({
  method: z.literal('edit').describe('Edit one or more local images with OpenAI image edits'),
  input: z.string().describe('Absolute path to the primary input image'),
  prompt: z.string().min(1).describe('Prompt describing the desired edit'),
  references: z.array(z.string()).optional().describe('Optional absolute paths to reference images'),
  mask: z.string().optional().describe('Optional absolute path to a mask image'),
  output: z.string().optional().describe('Optional absolute output path or template. Use {index} for multiple results.'),
  model: z.string().default('gpt-image-2').describe('Image model name'),
  n: z.number().int().min(1).max(10).default(1).describe('Number of edited outputs to request'),
  size: z.string().optional().describe('Explicit output size, for example 1536x1024 or auto'),
  width: z.number().int().positive().optional().describe('Requested output width in pixels'),
  height: z.number().int().positive().optional().describe('Requested output height in pixels'),
  aspectRatio: z.string().default('auto').describe('Aspect ratio preset or explicit ratio, for example 2:3 or 16:9'),
  scale: z.number().positive().default(1).describe('Relative scale factor used for derived sizing'),
  quality: z.enum(['auto', 'low', 'medium', 'high']).default('auto').describe('Requested output quality'),
  format: z.enum(['png', 'jpeg', 'webp']).default('png').describe('Output image format'),
  compression: z.number().int().min(0).max(100).optional().describe('Compression level for jpeg or webp output'),
  background: z.enum(['auto', 'opaque', 'transparent']).default('auto').describe('Requested background handling'),
  moderation: z.enum(['auto', 'low']).default('auto').describe('Requested moderation setting'),
  inputFidelity: z.enum(['low', 'high']).optional().describe('Optional input fidelity hint'),
  user: z.string().optional().describe('Optional end-user identifier passed to OpenAI'),
})

export const ImagesToolSchema = z.discriminatedUnion('method', [searchSchema, editSchema])

export type ImagesToolInput = z.infer<typeof ImagesToolSchema>
export type SearchImagesInput = z.infer<typeof searchSchema>
export type EditImagesInput = z.infer<typeof editSchema>

export const imagesToolJsonSchema: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    method: {
      type: 'string',
      enum: ['search', 'edit'],
      description: 'Which images method to call',
    },
    query: {
      type: 'string',
      minLength: 1,
      description: 'Search query',
    },
    provider: {
      type: 'string',
      enum: ['pexels'],
      default: 'pexels',
      description: 'Image provider to query',
    },
    orientation: {
      type: 'string',
      enum: ['landscape', 'portrait', 'square'],
      description: 'Preferred photo orientation',
    },
    size: {
      type: 'string',
      description: 'Explicit output size like 1536x1024 or provider-defined search size',
    },
    color: {
      type: 'string',
      description: 'Preferred dominant color for search',
    },
    locale: {
      type: 'string',
      description: 'Search locale',
    },
    page: {
      type: 'integer',
      minimum: 1,
      description: 'Search result page number',
    },
    perPage: {
      type: 'integer',
      minimum: 1,
      maximum: 80,
      description: 'Search results per page',
    },
    input: {
      type: 'string',
      description: 'Absolute path to the primary input image',
    },
    prompt: {
      type: 'string',
      minLength: 1,
      description: 'Prompt describing the desired edit',
    },
    references: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional absolute paths to reference images',
    },
    mask: {
      type: 'string',
      description: 'Optional absolute path to a mask image',
    },
    output: {
      type: 'string',
      description: 'Optional absolute output path or template. Use {index} for multiple results.',
    },
    model: {
      type: 'string',
      default: 'gpt-image-2',
      description: 'Image model name',
    },
    n: {
      type: 'integer',
      minimum: 1,
      maximum: 10,
      default: 1,
      description: 'Number of edited outputs to request',
    },
    width: {
      type: 'integer',
      minimum: 1,
      description: 'Requested output width in pixels',
    },
    height: {
      type: 'integer',
      minimum: 1,
      description: 'Requested output height in pixels',
    },
    aspectRatio: {
      type: 'string',
      default: 'auto',
      description: 'Aspect ratio preset or explicit ratio, for example 2:3 or 16:9',
    },
    scale: {
      type: 'number',
      exclusiveMinimum: 0,
      default: 1,
      description: 'Relative scale factor used for derived sizing',
    },
    quality: {
      type: 'string',
      enum: ['auto', 'low', 'medium', 'high'],
      default: 'auto',
      description: 'Requested output quality',
    },
    format: {
      type: 'string',
      enum: ['png', 'jpeg', 'webp'],
      default: 'png',
      description: 'Output image format',
    },
    compression: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      description: 'Compression level for jpeg or webp output',
    },
    background: {
      type: 'string',
      enum: ['auto', 'opaque', 'transparent'],
      default: 'auto',
      description: 'Requested background handling',
    },
    moderation: {
      type: 'string',
      enum: ['auto', 'low'],
      default: 'auto',
      description: 'Requested moderation setting',
    },
    inputFidelity: {
      type: 'string',
      enum: ['low', 'high'],
      description: 'Optional input fidelity hint',
    },
    user: {
      type: 'string',
      description: 'Optional end-user identifier passed to OpenAI',
    },
  },
  required: ['method'],
}
