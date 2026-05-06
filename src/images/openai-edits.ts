import type { ImageEditResult } from './types.ts'

export interface OpenAiImageEditsRequest {
  inputImage: { buffer: Buffer; filename: string; mimeType: string }
  referenceImages?: Array<{ buffer: Buffer; filename: string; mimeType: string }>
  maskImage?: { buffer: Buffer; filename: string; mimeType: string }
  prompt: string
  model: string
  n: number
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  format: 'png' | 'jpeg' | 'webp'
  compression?: number
  background: 'auto' | 'opaque' | 'transparent'
  moderation: 'auto' | 'low'
  inputFidelity?: 'low' | 'high'
  user?: string
}

export interface OpenAiImageEditsResponse {
  images: Array<{ b64Json: string; revisedPrompt?: string }>
  requestId?: string
  quality?: string
  background?: string
}

export interface OpenAiImageEditsClientOptions {
  apiKey?: string
  fetchImpl?: typeof fetch
}

interface RawOpenAiResponse {
  data?: Array<{
    b64_json?: string
    revised_prompt?: string
  }>
  quality?: string
  background?: string
  error?: {
    message?: string
  }
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set. Add it to the device server environment to enable images.edit.',
    )
  }

  return apiKey
}

function appendImage(form: FormData, field: string, image: { buffer: Buffer; filename: string; mimeType: string }): void {
  form.append(field, new Blob([image.buffer], { type: image.mimeType }), image.filename)
}

export async function requestOpenAiImageEdits(
  request: OpenAiImageEditsRequest,
  options: OpenAiImageEditsClientOptions = {},
): Promise<OpenAiImageEditsResponse> {
  const fetchImpl = options.fetchImpl ?? fetch
  const form = new FormData()

  form.append('model', request.model)
  appendImage(form, 'image[]', request.inputImage)
  for (const reference of request.referenceImages || []) {
    appendImage(form, 'image[]', reference)
  }

  if (request.maskImage) {
    appendImage(form, 'mask', request.maskImage)
  }

  form.append('prompt', request.prompt)
  form.append('quality', request.quality)
  form.append('size', request.size)
  form.append('output_format', request.format)
  form.append('background', request.background)
  form.append('moderation', request.moderation)
  form.append('n', String(request.n))

  if (request.compression != null) {
    form.append('output_compression', String(request.compression))
  }
  if (request.inputFidelity) {
    form.append('input_fidelity', request.inputFidelity)
  }
  if (request.user) {
    form.append('user', request.user)
  }

  const response = await fetchImpl('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireApiKey(options.apiKey)}`,
    },
    body: form,
  })

  const responseText = await response.text()
  let payload: RawOpenAiResponse = {}
  if (responseText) {
    try {
      payload = JSON.parse(responseText) as RawOpenAiResponse
    } catch {
      payload = {}
    }
  }

  if (!response.ok) {
    throw new Error(
      payload.error?.message
        || responseText
        || `OpenAI image edit failed with HTTP ${response.status}`,
    )
  }

  const images = (payload.data || [])
    .filter((item): item is NonNullable<RawOpenAiResponse['data']>[number] & { b64_json: string } => Boolean(item?.b64_json))
    .map((item) => ({
      b64Json: item.b64_json,
      revisedPrompt: item.revised_prompt || undefined,
    }))

  if (images.length === 0) {
    throw new Error('OpenAI returned no edited images')
  }

  return {
    images,
    requestId: response.headers.get('x-request-id') || undefined,
    quality: payload.quality,
    background: payload.background,
  }
}
