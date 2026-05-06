import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

function successResult(message, data) {
  return {
    ok: true,
    message,
    data,
  }
}

function errorResult(message, code) {
  return {
    ok: false,
    error: {
      message,
      ...(code ? { code } : {}),
    },
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
    throw new Error('CRAFT_DEVICE_SERVER_PACKAGE_ROOT is required for the images handler')
  }

  return await import(pathToFileURL(join(packageRoot, relativePath)).href)
}

async function main() {
  const raw = await readStdin()
  const payload = raw ? JSON.parse(raw) : {}

  if (payload.kind !== 'operation') {
    process.stdout.write(JSON.stringify(errorResult('Expected operation handler payload')))
    return
  }

  if (payload.tool !== 'images') {
    process.stdout.write(JSON.stringify(errorResult(`Unsupported tool: ${payload.tool}`)))
    return
  }

  const { createImagesService } = await loadPackageModule('src/images/service.ts')
  const imagesService = createImagesService({
    openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
    pexelsApiKey: process.env.PEXELS_API_KEY?.trim() || undefined,
  })

  try {
    if (payload.operation === 'search') {
      const result = await imagesService.search(payload.input)
      process.stdout.write(JSON.stringify(successResult(summarizeSearchResult(result), result)))
      return
    }

    if (payload.operation === 'edit') {
      const result = await imagesService.edit(payload.input)
      process.stdout.write(JSON.stringify(successResult(summarizeEditResult(result), result)))
      return
    }

    process.stdout.write(JSON.stringify(errorResult(`Unsupported operation: ${payload.operation}`)))
  } catch (error) {
    process.stdout.write(JSON.stringify(errorResult(error instanceof Error ? error.message : String(error))))
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
