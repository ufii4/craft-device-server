import {
  assertAbsolutePath,
  assertReadableFile,
  getImageDimensions,
  readImageUpload,
  resolveOutputPaths,
  writeBase64Image,
} from './files.ts'
import {
  deriveImageSize,
  shouldDeriveImageSize,
  validateExplicitSize,
} from './size-derivation.ts'
import { requestOpenAiImageEdits, type OpenAiImageEditsClientOptions } from './openai-edits.ts'
import type { EditImagesInput } from '../mcp/schemas.ts'
import type { ImageEditResult } from './types.ts'

export interface ImageEditServiceOptions extends OpenAiImageEditsClientOptions {}

function validateCompression(format: 'png' | 'jpeg' | 'webp', compression: number | undefined): void {
  if (compression == null) return

  if (format === 'png') {
    throw new Error('--compression only applies to jpeg or webp output')
  }

  if (!Number.isInteger(compression) || compression < 0 || compression > 100) {
    throw new Error('--compression must be an integer between 0 and 100')
  }
}

async function resolveSize(input: EditImagesInput): Promise<string> {
  if (input.size) {
    return validateExplicitSize(input.size)
  }

  if (!shouldDeriveImageSize({
    width: input.width,
    height: input.height,
    aspectRatio: input.aspectRatio,
    scale: input.scale,
  })) {
    return 'auto'
  }

  const dimensions = await getImageDimensions(input.input)
  return deriveImageSize({
    inputWidth: dimensions.width,
    inputHeight: dimensions.height,
    width: input.width,
    height: input.height,
    aspectRatio: input.aspectRatio,
    scale: input.scale,
  }).value
}

export async function editImage(
  input: EditImagesInput,
  options: ImageEditServiceOptions,
): Promise<ImageEditResult> {
  assertAbsolutePath(input.input, 'input')
  await assertReadableFile(input.input, 'Input image')

  for (const reference of input.references || []) {
    assertAbsolutePath(reference, 'reference image')
    await assertReadableFile(reference, 'Reference image')
  }

  if (input.mask) {
    assertAbsolutePath(input.mask, 'mask')
    await assertReadableFile(input.mask, 'Mask image')
  }

  if (input.output) {
    assertAbsolutePath(input.output, 'output')
  }

  validateCompression(input.format, input.compression)
  const resolvedSize = await resolveSize(input)

  const openAiResponse = await requestOpenAiImageEdits({
    inputImage: await readImageUpload(input.input),
    referenceImages: input.references ? await Promise.all(input.references.map((reference) => readImageUpload(reference))) : undefined,
    maskImage: input.mask ? await readImageUpload(input.mask) : undefined,
    prompt: input.prompt,
    model: input.model,
    n: input.n,
    size: resolvedSize,
    quality: input.quality,
    format: input.format,
    compression: input.compression,
    background: input.background,
    moderation: input.moderation,
    inputFidelity: input.inputFidelity,
    user: input.user,
  }, options)

  const outputPaths = resolveOutputPaths({
    inputPath: input.input,
    outputPath: input.output,
    format: input.format,
    count: openAiResponse.images.length,
  })

  await Promise.all(openAiResponse.images.map(async (image, index) => {
    await writeBase64Image(outputPaths[index]!, image.b64Json)
  }))

  return {
    method: 'edit',
    model: input.model,
    outputFormat: input.format,
    outputPaths,
    requestedCount: input.n,
    returnedCount: openAiResponse.images.length,
    resolvedSize,
    requestId: openAiResponse.requestId,
    revisedPrompt: openAiResponse.images[0]?.revisedPrompt,
    quality: openAiResponse.quality,
    background: openAiResponse.background,
  }
}
