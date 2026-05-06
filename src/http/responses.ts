import type { ServerResponse } from 'node:http'

export function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers((init.headers || {}) as Record<string, string>)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8')
  }
  return new Response(JSON.stringify(body), { ...init, headers })
}

export function errorResponse(status: number, message: string, headers?: Record<string, string>): Response {
  return jsonResponse({ error: message }, { status, headers })
}

export function unauthorizedResponse(): Response {
  return errorResponse(401, 'Unauthorized', {
    'WWW-Authenticate': 'Bearer realm="craft-device-server"',
  })
}

export function methodNotAllowedResponse(allow: string[]): Response {
  return errorResponse(405, 'Method not allowed', {
    Allow: allow.join(', '),
  })
}

export function writeNodeResponse(res: ServerResponse, response: Response): Promise<void> {
  return new Promise(async (resolve) => {
    const headers: Record<string, string | string[]> = {}

    response.headers.forEach((value, key) => {
      const existing = headers[key]
      if (existing) {
        headers[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
      } else {
        headers[key] = value
      }
    })

    res.writeHead(response.status, headers)
    if (response.body) {
      const buffer = Buffer.from(await response.arrayBuffer())
      res.end(buffer)
    } else {
      res.end()
    }

    resolve()
  })
}
