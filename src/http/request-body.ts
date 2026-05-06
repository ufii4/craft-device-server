export async function readRequestBody(req: Request): Promise<unknown | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return undefined
  }

  const text = await req.text()
  const trimmed = text.trim()
  if (!trimmed) {
    return undefined
  }

  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(trimmed) as unknown
    } catch (error) {
      throw new Error(`Invalid JSON request body: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return trimmed
}
