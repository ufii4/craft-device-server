import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDeviceServerHandler } from '../http/handler.ts'
import { DeviceRuntimeRegistry } from '../runtime/registry.ts'

const TOKEN = 'test-device-server-token'
const TEMP_DIRS: string[] = []

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'device-server-http-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

function writeLegacyRuntimeConfig(dir: string): void {
  mkdirSync(join(dir, 'handlers'), { recursive: true })
  writeFileSync(join(dir, 'http-routes.json'), JSON.stringify({ routes: [] }, null, 2))
  writeFileSync(join(dir, 'mcp-tools.json'), JSON.stringify({ tools: [] }, null, 2))
}

function writeToolConfig(dir: string, toolId: string, config: Record<string, unknown>, files: Record<string, string>): void {
  const toolDir = join(dir, 'tools', toolId)
  mkdirSync(toolDir, { recursive: true })
  writeFileSync(join(toolDir, 'config.json'), JSON.stringify(config, null, 2))
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(toolDir, relativePath)
    mkdirSync(join(absolutePath, '..'), { recursive: true })
    writeFileSync(absolutePath, content)
  }
}

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('createDeviceServerHandler', () => {
  it('keeps GET /health as a built-in route', async () => {
    const dir = createTempDir()
    writeLegacyRuntimeConfig(dir)

    const handler = createDeviceServerHandler({
      token: TOKEN,
      version: 'test',
      registry: await DeviceRuntimeRegistry.load(dir),
    })

    const response = await handler.fetch(new Request('http://localhost/health'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'craft-device-server',
    })
  })

  it('dispatches a tool-folder HTTP route through operation parsing and neutral handler execution', async () => {
    const dir = createTempDir()
    writeToolConfig(dir, 'echo', {
      id: 'echo',
      name: 'Echo',
      enabled: true,
      description: 'Echo tool',
      handler: {
        command: process.execPath,
        args: ['./handler.mjs'],
        timeoutMs: 1000,
      },
      operations: {
        send: {
          definition: './operations/send.definition.mjs',
          command: { argv: ['send'] },
        },
      },
      transports: {
        mcp: { enabled: false },
        http: {
          enabled: true,
          routes: [
            {
              method: 'POST',
              path: '/echo',
              operation: 'send',
              auth: 'none',
            },
          ],
        },
      },
    }, {
      'handler.mjs': `
        const chunks = []
        for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        process.stdout.write(JSON.stringify({
          ok: true,
          data: {
            request: payload.context.request,
            input: payload.input,
            operation: payload.operation,
          },
        }))
      `,
      'operations/send.definition.mjs': `
        export async function parse(rawInput) {
          if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
            throw new Error('input must be an object')
          }
          return {
            message: typeof rawInput.message === 'string' ? rawInput.message.toUpperCase() : 'MISSING',
          }
        }
        export const metadata = { inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }
      `,
    })

    const handler = createDeviceServerHandler({
      token: TOKEN,
      version: 'test-version',
      registry: await DeviceRuntimeRegistry.load(dir),
    })

    const response = await handler.fetch(new Request('http://localhost/echo?tag=one&tag=two', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'hello' }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      request: {
        method: 'POST',
        path: '/echo',
        headers: expect.objectContaining({
          'content-type': 'application/json',
        }),
        query: {
          tag: ['one', 'two'],
        },
      },
      input: {
        message: 'HELLO',
      },
      operation: 'send',
    })
  })

  it('enforces bearer auth for configured tool-folder routes', async () => {
    const dir = createTempDir()
    writeToolConfig(dir, 'secure', {
      id: 'secure',
      name: 'Secure',
      enabled: true,
      description: 'Secure tool',
      handler: {
        command: process.execPath,
        args: ['./handler.mjs'],
        timeoutMs: 1000,
      },
      operations: {
        send: {
          definition: './operations/send.definition.mjs',
          command: { argv: ['send'] },
        },
      },
      transports: {
        mcp: { enabled: false },
        http: {
          enabled: true,
          routes: [
            {
              method: 'POST',
              path: '/secure',
              operation: 'send',
              auth: 'bearer',
            },
          ],
        },
      },
    }, {
      'handler.mjs': 'process.stdout.write(JSON.stringify({ ok: true }))',
      'operations/send.definition.mjs': 'export async function parse(rawInput) { return rawInput ?? {} }',
    })

    const handler = createDeviceServerHandler({
      token: TOKEN,
      version: 'test',
      registry: await DeviceRuntimeRegistry.load(dir),
    })

    const response = await handler.fetch(new Request('http://localhost/secure', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 404 for unknown routes', async () => {
    const dir = createTempDir()
    writeLegacyRuntimeConfig(dir)

    const handler = createDeviceServerHandler({
      token: TOKEN,
      version: 'test',
      registry: await DeviceRuntimeRegistry.load(dir),
    })

    const response = await handler.fetch(new Request('http://localhost/missing'))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
  })

  it('rejects tool-folder requests with invalid parsed input before handler execution', async () => {
    const dir = createTempDir()
    writeToolConfig(dir, 'validate', {
      id: 'validate',
      name: 'Validate',
      enabled: true,
      description: 'Validation tool',
      handler: {
        command: process.execPath,
        args: ['./handler.mjs'],
        timeoutMs: 1000,
      },
      operations: {
        send: {
          definition: './operations/send.definition.mjs',
          command: { argv: ['send'] },
        },
      },
      transports: {
        mcp: { enabled: false },
        http: {
          enabled: true,
          routes: [
            {
              method: 'POST',
              path: '/validate',
              operation: 'send',
              auth: 'none',
            },
          ],
        },
      },
    }, {
      'handler.mjs': 'process.stdout.write(JSON.stringify({ ok: true }))',
      'operations/send.definition.mjs': 'export async function parse() { throw new Error("body is required") }',
    })

    const handler = createDeviceServerHandler({
      token: TOKEN,
      version: 'test',
      registry: await DeviceRuntimeRegistry.load(dir),
    })

    const response = await handler.fetch(new Request('http://localhost/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid operation input: body is required' })
  })
})
