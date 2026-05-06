function assertObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }
  return value
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
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

function optionalNumber(value, field, options = {}) {
  if (value == null) return undefined
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${field} must be a number`)
  }
  if (options.minExclusive != null && value <= options.minExclusive) {
    throw new Error(`${field} must be greater than ${options.minExclusive}`)
  }
  return value
}

function optionalStringArray(value, field) {
  if (value == null) return undefined
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`${field} must be an array of strings`)
  }
  return value.map((entry) => entry.trim())
}

const EDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    input: { type: 'string', description: 'Absolute path to the primary input image' },
    prompt: { type: 'string', minLength: 1, description: 'Prompt describing the desired edit' },
    references: { type: 'array', items: { type: 'string' }, description: 'Optional absolute paths to reference images' },
    mask: { type: 'string', description: 'Optional absolute path to a mask image' },
    output: { type: 'string', description: 'Optional absolute output path or template' },
    model: { type: 'string', default: 'gpt-image-2', description: 'Image model name' },
    n: { type: 'integer', minimum: 1, maximum: 10, default: 1, description: 'Number of edited outputs to request' },
    width: { type: 'integer', minimum: 1, description: 'Requested output width in pixels' },
    height: { type: 'integer', minimum: 1, description: 'Requested output height in pixels' },
    aspectRatio: { type: 'string', default: 'auto', description: 'Aspect ratio preset or explicit ratio' },
    scale: { type: 'number', exclusiveMinimum: 0, default: 1, description: 'Relative scale factor used for derived sizing' },
    quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'], default: 'auto' },
    format: { type: 'string', enum: ['png', 'jpeg', 'webp'], default: 'png' },
    compression: { type: 'integer', minimum: 0, maximum: 100 },
    background: { type: 'string', enum: ['auto', 'opaque', 'transparent'], default: 'auto' },
    moderation: { type: 'string', enum: ['auto', 'low'], default: 'auto' },
    inputFidelity: { type: 'string', enum: ['low', 'high'] },
    user: { type: 'string' }
  },
  required: ['input', 'prompt'],
}

export async function parse(rawInput) {
  const input = assertObject(rawInput ?? {}, 'images.edit input must be an object')
  const quality = optionalString(input.quality, 'quality') ?? 'auto'
  if (!['auto', 'low', 'medium', 'high'].includes(quality)) {
    throw new Error('quality must be one of auto, low, medium, high')
  }
  const format = optionalString(input.format, 'format') ?? 'png'
  if (!['png', 'jpeg', 'webp'].includes(format)) {
    throw new Error('format must be one of png, jpeg, webp')
  }
  const background = optionalString(input.background, 'background') ?? 'auto'
  if (!['auto', 'opaque', 'transparent'].includes(background)) {
    throw new Error('background must be one of auto, opaque, transparent')
  }
  const moderation = optionalString(input.moderation, 'moderation') ?? 'auto'
  if (!['auto', 'low'].includes(moderation)) {
    throw new Error('moderation must be one of auto, low')
  }
  const inputFidelity = optionalString(input.inputFidelity, 'inputFidelity')
  if (inputFidelity && !['low', 'high'].includes(inputFidelity)) {
    throw new Error('inputFidelity must be one of low, high')
  }

  return {
    input: requiredString(input.input, 'input'),
    prompt: requiredString(input.prompt, 'prompt'),
    references: optionalStringArray(input.references, 'references'),
    mask: optionalString(input.mask, 'mask'),
    output: optionalString(input.output, 'output'),
    model: optionalString(input.model, 'model') ?? 'gpt-image-2',
    n: optionalInteger(input.n, 'n', { min: 1, max: 10 }) ?? 1,
    width: optionalInteger(input.width, 'width', { min: 1 }),
    height: optionalInteger(input.height, 'height', { min: 1 }),
    aspectRatio: optionalString(input.aspectRatio, 'aspectRatio') ?? 'auto',
    scale: optionalNumber(input.scale, 'scale', { minExclusive: 0 }) ?? 1,
    quality,
    format,
    compression: optionalInteger(input.compression, 'compression', { min: 0, max: 100 }),
    background,
    moderation,
    inputFidelity,
    user: optionalString(input.user, 'user'),
  }
}

export const metadata = {
  summary: 'Edit one or more local images',
  inputSchema: EDIT_SCHEMA,
  mcp: {
    examples: [
      { method: 'edit', input: '/tmp/input.png', prompt: 'Add warm sunset lighting' },
    ],
  },
}
