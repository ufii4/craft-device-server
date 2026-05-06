import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { startDeviceServer, type StartedDeviceServer } from '../server.ts'

const TOKEN = 'device-server-reload-token'
const TEMP_DIRS: string[] = []
const SERVERS: StartedDeviceServer[] = []
const TRANSPORTS: StreamableHTTPClientTransport[] = []

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'device-server-reload-test-'))
  TEMP_DIRS.push(dir)
  return dir
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

async function connectClient(baseUrl: string): Promise<Client> {
  const client = new Client({ name: 'device-server-reload-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
      },
    },
  })
  TRANSPORTS.push(transport)
  await client.connect(transport)
  return client
}

async function waitFor(assertion: () => Promise<void> | void, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await Bun.sleep(100)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out after ${timeoutMs}ms waiting for condition`)
}

afterEach(async () => {
  while (TRANSPORTS.length > 0) {
    await TRANSPORTS.pop()?.close().catch(() => {})
  }

  while (SERVERS.length > 0) {
    await SERVERS.pop()?.close().catch(() => {})
  }

  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('device runtime hot reload', () => {
  it('swaps in new tool-folder route and tool definitions without restart', async () => {
    const dir = createTempDir()
    writeToolConfig(dir, 'alpha', {
      id: 'alpha',
      name: 'Alpha',
      enabled: true,
      description: 'Alpha tool',
      handler: { command: process.execPath, args: ['./handler.mjs'], timeoutMs: 1000 },
      operations: {
        send: { definition: './operations/send.definition.mjs', command: { argv: ['send'] } },
      },
      transports: {
        mcp: { enabled: true, toolName: 'alpha', description: 'Alpha tool', dispatch: { kind: 'single-operation', operation: 'send' } },
        http: { enabled: true, routes: [{ method: 'POST', path: '/alpha', operation: 'send', auth: 'none' }] },
      },
    }, {
      'handler.mjs': `
        const chunks = []
        for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        process.stdout.write(JSON.stringify({ ok: true, message: payload.tool, data: { route: 'alpha' } }))
      `,
      'operations/send.definition.mjs': 'export async function parse(rawInput) { return rawInput ?? {} } export const metadata = { inputSchema: { type: "object" } }',
    })

    const server = await startDeviceServer({
      config: {
        host: '127.0.0.1',
        port: 0,
        token: TOKEN,
        runtimeConfigDir: dir,
      },
      version: 'test',
    })
    SERVERS.push(server)

    const client = await connectClient(server.url)

    const initialRoute = await fetch(`${server.url}/alpha`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    expect(await initialRoute.json()).toEqual({ ok: true, route: 'alpha', message: 'alpha' })

    const initialTools = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
    expect(initialTools.tools.map((tool) => tool.name)).toEqual(['alpha'])

    rmSync(join(dir, 'tools', 'alpha'), { recursive: true, force: true })
    writeToolConfig(dir, 'beta', {
      id: 'beta',
      name: 'Beta',
      enabled: true,
      description: 'Beta tool',
      handler: { command: process.execPath, args: ['./handler.mjs'], timeoutMs: 1000 },
      operations: {
        send: { definition: './operations/send.definition.mjs', command: { argv: ['send'] } },
      },
      transports: {
        mcp: { enabled: true, toolName: 'beta', description: 'Beta tool', dispatch: { kind: 'single-operation', operation: 'send' } },
        http: { enabled: true, routes: [{ method: 'POST', path: '/beta', operation: 'send', auth: 'none' }] },
      },
    }, {
      'handler.mjs': `
        const chunks = []
        for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        process.stdout.write(JSON.stringify({ ok: true, message: payload.tool, data: { route: 'beta' } }))
      `,
      'operations/send.definition.mjs': 'export async function parse(rawInput) { return rawInput ?? {} } export const metadata = { inputSchema: { type: "object" } }',
    })

    await waitFor(async () => {
      const routeResponse = await fetch(`${server.url}/beta`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      expect(routeResponse.status).toBe(200)
      expect(await routeResponse.json()).toEqual({ ok: true, route: 'beta', message: 'beta' })

      const tools = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
      expect(tools.tools.map((tool) => tool.name)).toEqual(['beta'])
    })

    const oldRoute = await fetch(`${server.url}/alpha`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    expect(oldRoute.status).toBe(404)
  })

  it('keeps serving the last-known-good tool-folder config after an invalid edit', async () => {
    const dir = createTempDir()
    writeToolConfig(dir, 'stable', {
      id: 'stable',
      name: 'Stable',
      enabled: true,
      description: 'Stable tool',
      handler: { command: process.execPath, args: ['./handler.mjs'], timeoutMs: 1000 },
      operations: {
        send: { definition: './operations/send.definition.mjs', command: { argv: ['send'] } },
      },
      transports: {
        mcp: { enabled: true, toolName: 'stable', description: 'Stable tool', dispatch: { kind: 'single-operation', operation: 'send' } },
        http: { enabled: true, routes: [{ method: 'POST', path: '/stable', operation: 'send', auth: 'none' }] },
      },
    }, {
      'handler.mjs': 'process.stdout.write(JSON.stringify({ ok: true, data: { route: "stable" } }))',
      'operations/send.definition.mjs': 'export async function parse(rawInput) { return rawInput ?? {} } export const metadata = { inputSchema: { type: "object" } }',
    })

    const server = await startDeviceServer({
      config: {
        host: '127.0.0.1',
        port: 0,
        token: TOKEN,
        runtimeConfigDir: dir,
      },
      version: 'test',
    })
    SERVERS.push(server)

    const client = await connectClient(server.url)

    writeFileSync(join(dir, 'tools', 'stable', 'config.json'), JSON.stringify({
      id: 'stable',
      name: 'Stable',
      enabled: true,
      description: 'Stable tool',
      handler: { command: '', args: ['./handler.mjs'], timeoutMs: 1000 },
      operations: {
        send: { definition: './operations/send.definition.mjs', command: { argv: ['send'] } },
      },
      transports: {
        mcp: { enabled: true, toolName: 'stable', description: 'Stable tool', dispatch: { kind: 'single-operation', operation: 'send' } },
        http: { enabled: true, routes: [{ method: 'POST', path: '/stable', operation: 'send', auth: 'none' }] },
      },
    }, null, 2))

    await Bun.sleep(400)

    const routeResponse = await fetch(`${server.url}/stable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    expect(routeResponse.status).toBe(200)
    expect(await routeResponse.json()).toEqual({ ok: true, route: 'stable' })

    const tools = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)
    expect(tools.tools.map((tool) => tool.name)).toEqual(['stable'])
  })
})
