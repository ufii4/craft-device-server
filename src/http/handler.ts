import { handleHealthRequest } from './routes/health.ts'
import { handleDynamicHttpRoute } from './routes/dynamic.ts'
import { errorResponse } from './responses.ts'
import type { DeviceRuntimeRegistry } from '../runtime/registry.ts'

export interface DeviceServerHandlerOptions {
  token: string
  version: string
  registry: DeviceRuntimeRegistry
}

export interface DeviceServerHandler {
  fetch: (req: Request) => Promise<Response>
}

export function createDeviceServerHandler(
  options: DeviceServerHandlerOptions,
): DeviceServerHandler {
  return {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)

      if (url.pathname === '/health') {
        if (req.method !== 'GET') {
          return errorResponse(405, 'Method not allowed', { Allow: 'GET' })
        }
        return handleHealthRequest()
      }

      return await handleDynamicHttpRoute(req, options)
    },
  }
}
