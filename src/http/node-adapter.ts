import type { IncomingMessage, ServerResponse } from 'node:http'
import { writeNodeResponse } from './responses.ts'

type WebHandler = (req: Request) => Promise<Response> | Response

export function nodeHttpAdapter(
  handler: WebHandler,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (nodeReq, nodeRes) => {
    handleRequest(handler, nodeReq, nodeRes).catch((error) => {
      console.error('[device-server] Unhandled HTTP error:', error)
      if (!nodeRes.headersSent) {
        nodeRes.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      }
      nodeRes.end('Internal Server Error')
    })
  }
}

async function handleRequest(
  handler: WebHandler,
  nodeReq: IncomingMessage,
  nodeRes: ServerResponse,
): Promise<void> {
  const encrypted = !!(nodeReq.socket as { encrypted?: boolean }).encrypted
  const protocol = encrypted ? 'https' : 'http'
  const host = nodeReq.headers.host ?? 'localhost'
  const url = `${protocol}://${host}${nodeReq.url ?? '/'}`

  const headers = new Headers()
  const raw = nodeReq.rawHeaders
  for (let i = 0; i < raw.length; i += 2) {
    headers.append(raw[i]!, raw[i + 1]!)
  }

  let body: Buffer | null = null
  if (nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of nodeReq) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
    body = Buffer.concat(chunks)
  }

  const request = new Request(url, {
    method: nodeReq.method,
    headers,
    body,
  })

  const response = await handler(request)
  await writeNodeResponse(nodeRes, response)
}
