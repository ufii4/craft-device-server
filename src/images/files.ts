import { mkdir, readFile, access, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, parse } from 'node:path'
import sharp from 'sharp'

const INPUT_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export function assertAbsolutePath(path: string, label: string): void {
  if (!isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path`)
  }
}

export async function assertReadableFile(path: string, label: string): Promise<void> {
  try {
    await access(path, fsConstants.R_OK)
  } catch {
    throw new Error(`${label} not found or not readable: ${path}`)
  }
}

export async function readImageUpload(path: string): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  const extension = extname(path).toLowerCase()
  const mimeType = INPUT_MIME_BY_EXTENSION[extension]
  if (!mimeType) {
    throw new Error(`Unsupported image file extension for upload: ${path}`)
  }

  return {
    buffer: await readFile(path),
    filename: basename(path),
    mimeType,
  }
}

export async function getImageDimensions(path: string): Promise<{ width: number; height: number }> {
  const metadata = await sharp(path).metadata().catch(() => null)
  if (!metadata?.width || !metadata?.height) {
    throw new Error(`Unable to determine image dimensions for: ${path}`)
  }

  return {
    width: metadata.width,
    height: metadata.height,
  }
}

function applyOutputIndex(path: string, index: number, total: number): string {
  if (total === 1) return path

  if (path.includes('{index}')) {
    return path.replaceAll('{index}', String(index))
  }

  const parsed = parse(path)
  return join(parsed.dir, `${parsed.name}_${index}${parsed.ext}`)
}

export function resolveDefaultOutputPath(inputPath: string, format: 'png' | 'jpeg' | 'webp'): string {
  const parsed = parse(inputPath)
  return join(parsed.dir, `${parsed.name}_edited.${format}`)
}

export function resolveOutputPaths(options: {
  inputPath: string
  outputPath?: string
  format: 'png' | 'jpeg' | 'webp'
  count: number
}): string[] {
  const basePath = options.outputPath || resolveDefaultOutputPath(options.inputPath, options.format)
  return Array.from({ length: options.count }, (_, index) => applyOutputIndex(basePath, index + 1, options.count))
}

export async function writeBase64Image(path: string, base64Data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.from(base64Data, 'base64'))
}
