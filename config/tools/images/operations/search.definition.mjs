function assertObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }
  return value
}

function optionalString(value, field) {
  if (value == null) return undefined
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`)
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function optionalInteger(value, field, options = {}) {
  if (value == null) return undefined
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`)
  }
  if (options.min != null && value < options.min) {
    throw new Error(`${field} must be at least ${options.min}`)
  }
  if (options.max != null && value > options.max) {
    throw new Error(`${field} must be at most ${options.max}`)
  }
  return value
}

const SEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
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
      description: 'Provider-defined image size filter',
    },
    color: {
      type: 'string',
      description: 'Preferred dominant color',
    },
    locale: {
      type: 'string',
      description: 'Search locale',
    },
    page: {
      type: 'integer',
      minimum: 1,
      description: 'Result page number',
    },
    perPage: {
      type: 'integer',
      minimum: 1,
      maximum: 80,
      description: 'Results per page',
    }
  },
  required: ['query'],
}

export async function parse(rawInput) {
  const input = assertObject(rawInput ?? {}, 'images.search input must be an object')
  const query = optionalString(input.query, 'query')
  if (!query) {
    throw new Error('query is required')
  }

  const provider = optionalString(input.provider, 'provider') ?? 'pexels'
  if (provider !== 'pexels') {
    throw new Error('provider must be pexels')
  }

  const orientation = optionalString(input.orientation, 'orientation')
  if (orientation && !['landscape', 'portrait', 'square'].includes(orientation)) {
    throw new Error('orientation must be one of landscape, portrait, square')
  }

  return {
    query,
    provider,
    orientation,
    size: optionalString(input.size, 'size'),
    color: optionalString(input.color, 'color'),
    locale: optionalString(input.locale, 'locale'),
    page: optionalInteger(input.page, 'page', { min: 1 }),
    perPage: optionalInteger(input.perPage, 'perPage', { min: 1, max: 80 }),
  }
}

export const metadata = {
  summary: 'Search stock images',
  inputSchema: SEARCH_SCHEMA,
  mcp: {
    examples: [
      { method: 'search', query: 'cats' },
    ],
  },
}
