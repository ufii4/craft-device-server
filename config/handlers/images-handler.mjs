import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

function successResult(text, structuredContent) {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
    isError: false,
  }
}

function errorResult(message, structuredContent = {}) {
  return {
    content: [{ type: 'text', text: `[ERROR] ${message}` }],
    structuredContent,
    isError: true,
  }
}

function summarizeSearchResult(result) {
  const lines = [
    `Found ${result.results.length} image${result.results.length === 1 ? '' : 's'} for "${result.query}" via ${result.provider}.`,
  ]

  for (const image of result.results) {
    lines.push(`- ${image.ref} — ${image.alt || 'Untitled'} (${image.width}x${image.height}) by ${image.photographer}`)
  }

  return lines.join('\n')
}

function summarizeEditResult(result) {
  const lines = [
    `Saved ${result.returnedCount} edited image${result.returnedCount === 1 ? '' : 's'} (${result.resolvedSize}, ${result.outputFormat}).`,
    ...result.outputPaths.map((path) => `- ${path}`),
  ]

  if (result.revisedPrompt) {
    lines.push(`Revised prompt: ${result.revisedPrompt}`)
  }

  return lines.join('\n')
}

function toStructuredContent(value) {
  return value && typeof value === 'object' ? value : { value }
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function loadPackageModule(relativePath) {
  const packageRoot = process.env.CRAFT_DEVICE_SERVER_PACKAGE_ROOT?.trim()
  if (!packageRoot) {
    throw new Error('CRAFT_DEVICE_SERVER_PACKAGE_ROOT is required for images-handler.mjs')
  }

  return await import(pathToFileURL(join(packageRoot, relativePath)).href)
}

async function main() {
  const raw = await readStdin()
  const payload = raw ? JSON.parse(raw) : {}

  if (payload.kind !== 'mcp') {
    process.stdout.write(JSON.stringify(errorResult('Expected mcp handler payload')))
    return
  }

  const [{ createImagesService }, { ImagesToolSchema }] = await Promise.all([
    loadPackageModule('src/images/service.ts'),
    loadPackageModule('src/mcp/schemas.ts'),
  ])

  const parsed = ImagesToolSchema.safeParse(payload.tool?.arguments || {})
  if (!parsed.success) {
    process.stdout.write(JSON.stringify(errorResult(
      `Invalid images tool input: ${parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
        return `${path}${issue.message}`
      }).join('; ')}`,
    )))
    return
  }

  const imagesService = createImagesService({
    openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
    pexelsApiKey: process.env.PEXELS_API_KEY?.trim() || undefined,
  })

  try {
    if (parsed.data.method === 'search') {
      const result = await imagesService.search(parsed.data)
      process.stdout.write(JSON.stringify(successResult(summarizeSearchResult(result), toStructuredContent(result))))
      return
    }

    const result = await imagesService.edit(parsed.data)
    process.stdout.write(JSON.stringify(successResult(summarizeEditResult(result), toStructuredContent(result))))
  } catch (error) {
    process.stdout.write(JSON.stringify(errorResult(error instanceof Error ? error.message : String(error))))
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
