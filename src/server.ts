import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http'
import { createDeviceServerHandler } from './http/handler.ts'
import { nodeHttpAdapter } from './http/node-adapter.ts'
import { hasValidBearerToken } from './http/auth.ts'
import { unauthorizedResponse, writeNodeResponse } from './http/responses.ts'
import { createDeviceMcpServer } from './mcp/server.ts'
import type { ImagesService } from './images/service.ts'
import type { NotificationService } from './notifications/service.ts'
import { DeviceRuntimeRegistry } from './runtime/registry.ts'
import { DeviceRuntimeWatcher } from './runtime/watcher.ts'
import type { DeviceServerConfig } from './config.ts'

export interface StartDeviceServerOptions {
  config: DeviceServerConfig
  version: string
  notificationService?: NotificationService
  imagesService?: ImagesService
}

export interface StartedDeviceServer {
  host: string
  port: number
  url: string
  mcpUrl: string
  close(): Promise<void>
}

function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

async function readJsonBody(req: IncomingMessage): Promise<unknown | undefined> {
  if (req.method !== 'POST') return undefined

  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }

  if (chunks.length === 0) return undefined

  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return undefined

  return JSON.parse(text) as unknown
}

function isNotificationMessage(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false

  const record = body as Record<string, unknown>
  return typeof record.method === 'string'
    && record.method.startsWith('notifications/')
    && record.id == null
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
}

export async function startDeviceServer(
  options: StartDeviceServerOptions,
): Promise<StartedDeviceServer> {
  const registry = await DeviceRuntimeRegistry.load(options.config.runtimeConfigDir)
  const watcher = new DeviceRuntimeWatcher(registry, {
    onReload(result) {
      if (result.success) {
        console.log(
          `[device-server] Reloaded runtime config from ${result.snapshot.configDir} `
            + `(${result.snapshot.routes.length} routes, ${result.snapshot.tools.length} tools)`,
        )
        return
      }

      console.error('[device-server] Failed to reload runtime config:', result.error)
    },
  })

  const httpHandler = createDeviceServerHandler({
    token: options.config.token,
    version: options.version,
    registry,
  })

  const webListener = nodeHttpAdapter(httpHandler.fetch)
  const mcpServer = await createDeviceMcpServer({
    version: options.version,
    registry,
  })

  const httpServer: HttpServer = createServer(async (req, res) => {
    const pathname = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`).pathname

    if (pathname === '/mcp') {
      const authorization = Array.isArray(req.headers.authorization)
        ? req.headers.authorization[0]
        : req.headers.authorization
      const isAuthorized = hasValidBearerToken(authorization, options.config.token)
      const isLoopback = isLoopbackAddress(req.socket.remoteAddress)

      if (!isAuthorized && !isLoopback) {
        await writeNodeResponse(res, unauthorizedResponse())
        return
      }

      try {
        const body = await readJsonBody(req)
        if (isNotificationMessage(body)) {
          res.writeHead(202)
          res.end()
          return
        }

        await mcpServer.handleRequest(req, res, body)
      } catch (error) {
        console.error('[device-server] MCP request failed:', error)
        if (!res.headersSent) {
          res.writeHead(500)
          res.end()
        }
      }
      return
    }

    webListener(req, res)
  })

  const address = await new Promise<{ port: number }>((resolve, reject) => {
    httpServer.listen(options.config.port, options.config.host, () => {
      const currentAddress = httpServer.address()
      if (!currentAddress || typeof currentAddress === 'string') {
        reject(new Error('Unable to determine device server listening address'))
        return
      }

      resolve({ port: currentAddress.port })
    })
    httpServer.on('error', reject)
  })

  watcher.start()

  const hostForUrl = formatHostForUrl(options.config.host)
  const url = `http://${hostForUrl}:${address.port}`

  return {
    host: options.config.host,
    port: address.port,
    url,
    mcpUrl: `${url}/mcp`,
    async close() {
      watcher.stop()
      await mcpServer.close()
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
    },
  }
}
