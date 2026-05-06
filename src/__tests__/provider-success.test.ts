import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImagesService } from '../images/service.ts'
import { ImagesToolSchema } from '../mcp/schemas.ts'

const TEMP_DIRS: string[] = []
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn6zk8AAAAASUVORK5CYII=',
  'base64',
)

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'device-server-provider-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

function writeTempImage(dir: string, name: string): string {
  const path = join(dir, name)
  writeFileSync(path, ONE_BY_ONE_PNG)
  return path
}

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('provider-backed image success paths', () => {
  it('constructs a Pexels search request and returns normalized results', async () => {
    let requestUrl: URL | null = null
    let requestHeaders: Headers | null = null

    const fetchImpl = (async (input, init) => {
      requestUrl = new URL(String(input))
      requestHeaders = new Headers(init?.headers)

      return new Response(JSON.stringify({
        page: 2,
        per_page: 3,
        total_results: 99,
        photos: [
          {
            id: 12345,
            width: 1600,
            height: 900,
            alt: 'Aurora over mountain lake',
            avg_color: '#88AAFF',
            photographer: 'Casey Rivera',
            url: 'https://www.pexels.com/photo/12345/',
            src: {
              medium: 'https://images.pexels.com/photos/12345/medium.jpeg',
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const images = createImagesService({
      pexelsApiKey: 'pexels-test-key',
      fetchImpl,
    })

    const parsed = ImagesToolSchema.parse({
      method: 'search',
      query: 'aurora lake',
      provider: 'pexels',
      orientation: 'landscape',
      size: 'large',
      color: 'blue',
      locale: 'en-US',
      page: 2,
      perPage: 3,
    })

    if (parsed.method !== 'search') {
      throw new Error('Expected search input')
    }

    const result = await images.search(parsed)

    expect(requestUrl).not.toBeNull()
    expect(requestHeaders).not.toBeNull()
    expect(requestUrl!.toString()).toBe(
      'https://api.pexels.com/v1/search?query=aurora+lake&orientation=landscape&size=large&color=blue&locale=en-US&page=2&per_page=3',
    )
    expect(requestHeaders!.get('authorization')).toBe('pexels-test-key')
    expect(requestHeaders!.get('accept')).toBe('application/json')
    expect(result).toEqual({
      method: 'search',
      provider: 'pexels',
      query: 'aurora lake',
      page: 2,
      perPage: 3,
      totalResults: 99,
      results: [
        {
          provider: 'pexels',
          id: '12345',
          ref: 'pexels:12345',
          alt: 'Aurora over mountain lake',
          width: 1600,
          height: 900,
          photographer: 'Casey Rivera',
          attributionUrl: 'https://www.pexels.com/photo/12345/',
          previewUrl: 'https://images.pexels.com/photos/12345/medium.jpeg',
          avgColor: '#88AAFF',
        },
      ],
    })
  })

  it('constructs an OpenAI image-edit request and persists returned outputs', async () => {
    const dir = createTempDir()
    const inputPath = writeTempImage(dir, 'input.png')
    const referencePath = writeTempImage(dir, 'reference.png')
    const maskPath = writeTempImage(dir, 'mask.png')

    const outputOne = Buffer.from('edited-image-one')
    const outputTwo = Buffer.from('edited-image-two')

    let requestUrl = ''
    let requestMethod = ''
    let requestHeaders: Headers | null = null
    let requestFormData: FormData | null = null

    const fetchImpl = (async (input, init) => {
      requestUrl = String(input)
      requestMethod = init?.method || 'GET'
      requestHeaders = new Headers(init?.headers)
      requestFormData = init?.body as FormData

      return new Response(JSON.stringify({
        data: [
          {
            b64_json: outputOne.toString('base64'),
            revised_prompt: 'Make the scene cinematic with warm lighting',
          },
          {
            b64_json: outputTwo.toString('base64'),
          },
        ],
        quality: 'high',
        background: 'transparent',
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': 'req_test_123',
        },
      })
    }) as typeof fetch

    const images = createImagesService({
      openaiApiKey: 'openai-test-key',
      fetchImpl,
    })

    const parsed = ImagesToolSchema.parse({
      method: 'edit',
      input: inputPath,
      references: [referencePath],
      mask: maskPath,
      prompt: 'Make the scene cinematic with warm lighting',
      output: join(dir, 'edited-{index}.webp'),
      n: 2,
      size: '1024x1024',
      quality: 'high',
      format: 'webp',
      compression: 72,
      background: 'transparent',
      moderation: 'low',
      inputFidelity: 'high',
      user: 'audit-test-user',
    })

    if (parsed.method !== 'edit') {
      throw new Error('Expected edit input')
    }

    const result = await images.edit(parsed)

    expect(requestUrl).toBe('https://api.openai.com/v1/images/edits')
    expect(requestMethod).toBe('POST')
    expect(requestHeaders).not.toBeNull()
    expect(requestHeaders!.get('authorization')).toBe('Bearer openai-test-key')
    expect(requestFormData).not.toBeNull()

    const form = requestFormData!
    expect(form.get('model')).toBe('gpt-image-2')
    expect(form.get('prompt')).toBe('Make the scene cinematic with warm lighting')
    expect(form.get('quality')).toBe('high')
    expect(form.get('size')).toBe('1024x1024')
    expect(form.get('output_format')).toBe('webp')
    expect(form.get('background')).toBe('transparent')
    expect(form.get('moderation')).toBe('low')
    expect(form.get('n')).toBe('2')
    expect(form.get('output_compression')).toBe('72')
    expect(form.get('input_fidelity')).toBe('high')
    expect(form.get('user')).toBe('audit-test-user')

    const uploadedImages = form.getAll('image[]') as File[]
    expect(uploadedImages).toHaveLength(2)
    expect(uploadedImages.map((file) => file.name)).toEqual(['input.png', 'reference.png'])
    expect(Buffer.from(await uploadedImages[0]!.arrayBuffer())).toEqual(ONE_BY_ONE_PNG)
    expect(Buffer.from(await uploadedImages[1]!.arrayBuffer())).toEqual(ONE_BY_ONE_PNG)

    const maskFile = form.get('mask') as File
    expect(maskFile.name).toBe('mask.png')
    expect(Buffer.from(await maskFile.arrayBuffer())).toEqual(ONE_BY_ONE_PNG)

    expect(result).toEqual({
      method: 'edit',
      model: 'gpt-image-2',
      outputFormat: 'webp',
      outputPaths: [
        join(dir, 'edited-1.webp'),
        join(dir, 'edited-2.webp'),
      ],
      requestedCount: 2,
      returnedCount: 2,
      resolvedSize: '1024x1024',
      requestId: 'req_test_123',
      revisedPrompt: 'Make the scene cinematic with warm lighting',
      quality: 'high',
      background: 'transparent',
    })

    expect(readFileSync(join(dir, 'edited-1.webp'))).toEqual(outputOne)
    expect(readFileSync(join(dir, 'edited-2.webp'))).toEqual(outputTwo)
  })
})
