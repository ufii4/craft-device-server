import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { startDeviceServer, type StartedDeviceServer } from '../server.ts'

const TOKEN = 'device-server-test-token'
const TEMP_DIRS: string[] = []
const SERVERS: StartedDeviceServer[] = []
const TRANSPORTS: StreamableHTTPClientTransport[] = []

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'device-server-mcp-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

function writeLegacyRuntimeConfig(dir: string, tools: unknown[]): void {
  mkdirSync(join(dir, 'handlers'), { recursive: true })
  writeFileSync(join(dir, 'http-routes.json'), JSON.stringify({ routes: [] }, null, 2))
  writeFileSync(join(dir, 'mcp-tools.json'), JSON.stringify({ tools }, null, 2))
}

function writeLegacyHandler(dir: string, name: string, source: string): void {
  writeFileSync(join(dir, 'handlers', name), source)
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
  const client = new Client({ name: 'device-server-test-client', version: '1.0.0' })
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

describe('device MCP server', () => {
  it('lists configured tool-folder MCP tools', async () => {
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
        mcp: {
          enabled: true,
          toolName: 'echo',
          description: 'Echo tool',
          dispatch: { kind: 'single-operation', operation: 'send' },
        },
        http: { enabled: false, routes: [] },
      },
    }, {
      'handler.mjs': 'process.stdout.write(JSON.stringify({ ok: true }))',
      'operations/send.definition.mjs': `
        export async function parse(rawInput) { return rawInput ?? {} }
        export const metadata = { inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }
      `,
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
    const result = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema)

    expect(result.tools).toHaveLength(1)
    expect(result.tools[0]).toMatchObject({
      name: 'echo',
      description: 'Echo tool',
    })
  })

  it('dispatches multi-operation MCP tools through operation parsing and neutral handlers', async () => {
    const dir = createTempDir()
    writeToolConfig(dir, 'images', {
      id: 'images',
      name: 'Images',
      enabled: true,
      description: 'Images tool',
      handler: {
        command: process.execPath,
        args: ['./handler.mjs'],
        timeoutMs: 1000,
      },
      operations: {
        search: {
          definition: './operations/search.definition.mjs',
          command: { argv: ['search'] },
        },
        edit: {
          definition: './operations/edit.definition.mjs',
          command: { argv: ['edit'] },
        },
      },
      transports: {
        mcp: {
          enabled: true,
          toolName: 'images',
          description: 'Images tool',
          dispatch: {
            kind: 'field',
            field: 'method',
            operations: {
              search: 'search',
              edit: 'edit',
            },
          },
        },
        http: { enabled: false, routes: [] },
      },
    }, {
      'handler.mjs': `
        const chunks = []
        for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        process.stdout.write(JSON.stringify({
          ok: true,
          message: 'handled ' + payload.operation,
          data: {
            input: payload.input,
            operation: payload.operation,
            trigger: payload.context.trigger,
          },
        }))
      `,
      'operations/search.definition.mjs': `
        export async function parse(rawInput) {
          return { query: String(rawInput.query).toUpperCase() }
        }
        export const metadata = { inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }
      `,
      'operations/edit.definition.mjs': `
        export async function parse(rawInput) {
          return { prompt: String(rawInput.prompt).toLowerCase() }
        }
        export const metadata = { inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } }
      `,
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
    const result = await client.request({
      method: 'tools/call',
      params: {
        name: 'images',
        arguments: {
          method: 'search',
          query: 'hello',
        },
      },
    }, CallToolResultSchema)

    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'handled search' })
    expect(result.structuredContent).toEqual({
      input: {
        query: 'HELLO',
      },
      operation: 'search',
      trigger: 'mcp',
    })
  })

  it('returns a transport-level error result for missing MCP dispatch metadata', async () => {
    const dir = createTempDir()
    writeToolConfig(dir, 'images', {
      id: 'images',
      name: 'Images',
      enabled: true,
      description: 'Images tool',
      handler: {
        command: process.execPath,
        args: ['./handler.mjs'],
        timeoutMs: 1000,
      },
      operations: {
        search: {
          definition: './operations/search.definition.mjs',
          command: { argv: ['search'] },
        },
      },
      transports: {
        mcp: {
          enabled: true,
          toolName: 'images',
          description: 'Images tool',
          dispatch: {
            kind: 'field',
            field: 'method',
            operations: {
              search: 'search',
            },
          },
        },
        http: { enabled: false, routes: [] },
      },
    }, {
      'handler.mjs': 'process.stdout.write(JSON.stringify({ ok: true }))',
      'operations/search.definition.mjs': 'export async function parse(rawInput) { return rawInput ?? {} }',
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
    const result = await client.request({
      method: 'tools/call',
      params: {
        name: 'images',
        arguments: {
          query: 'hello',
        },
      },
    }, CallToolResultSchema)

    expect(result.isError).toBe(true)
    expect(result.content[0] && 'text' in result.content[0] ? result.content[0].text : '').toContain('Missing MCP dispatch field: method')
  })

  it('surfaces only plain-text comment content for successful troll-style MCP responses', async () => {
    const dir = createTempDir()
    writeToolConfig(dir, 'troll', {
      id: 'troll',
      name: 'Troll',
      enabled: true,
      description: 'Troll tool',
      handler: {
        command: process.execPath,
        args: ['./handler.mjs'],
        timeoutMs: 1000,
      },
      operations: {
        run: {
          definition: './operations/run.definition.mjs',
          command: { argv: ['run'] },
        },
      },
      transports: {
        mcp: {
          enabled: true,
          toolName: 'troll',
          description: 'Troll tool',
          dispatch: { kind: 'single-operation', operation: 'run' },
        },
        http: { enabled: false, routes: [] },
      },
    }, {
      'handler.mjs': `
        process.stdout.write(JSON.stringify({
          ok: true,
          data: 'comment text',
          hints: {
            mcpContent: [{ type: 'text', text: 'comment text' }],
            suppressMcpStructuredContent: true,
          },
        }))
      `,
      'operations/run.definition.mjs': `
        export async function parse(rawInput) { return rawInput ?? {} }
        export const metadata = { inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } }
      `,
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
    const result = await client.request({
      method: 'tools/call',
      params: {
        name: 'troll',
        arguments: {
          prompt: 'hello',
        },
      },
    }, CallToolResultSchema)

    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: 'comment text' }])
    expect(result.structuredContent).toBeUndefined()
  })

  it('preserves empty-content success for troll-style no-comment MCP responses', async () => {
    const dir = createTempDir()
    writeToolConfig(dir, 'troll', {
      id: 'troll',
      name: 'Troll',
      enabled: true,
      description: 'Troll tool',
      handler: {
        command: process.execPath,
        args: ['./handler.mjs'],
        timeoutMs: 1000,
      },
      operations: {
        run: {
          definition: './operations/run.definition.mjs',
          command: { argv: ['run'] },
        },
      },
      transports: {
        mcp: {
          enabled: true,
          toolName: 'troll',
          description: 'Troll tool',
          dispatch: { kind: 'single-operation', operation: 'run' },
        },
        http: { enabled: false, routes: [] },
      },
    }, {
      'handler.mjs': `
        process.stdout.write(JSON.stringify({
          ok: true,
          hints: {
            httpStatus: 204,
            mcpContent: [],
          },
        }))
      `,
      'operations/run.definition.mjs': `
        export async function parse(rawInput) { return rawInput ?? {} }
        export const metadata = { inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } }
      `,
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
    const result = await client.request({
      method: 'tools/call',
      params: {
        name: 'troll',
        arguments: {
          prompt: 'hello',
        },
      },
    }, CallToolResultSchema)

    expect(result.isError).toBe(false)
    expect(result.content).toEqual([])
    expect(result.structuredContent).toBeUndefined()
  })

  it('falls back to legacy MCP config when no tool folders exist', async () => {
    const dir = createTempDir()
    writeLegacyRuntimeConfig(dir, [
      {
        name: 'echo',
        description: 'Legacy echo tool',
        inputSchema: { type: 'object' },
        handler: {
          command: process.execPath,
          args: ['./handlers/echo-tool.mjs'],
          timeoutMs: 1000,
        },
      },
    ])
    writeLegacyHandler(dir, 'echo-tool.mjs', `
      process.stdout.write(JSON.stringify({
        content: [{ type: 'text', text: 'legacy' }],
        structuredContent: { mode: 'legacy' },
        isError: false,
      }))
    `)

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
    const result = await client.request({
      method: 'tools/call',
      params: {
        name: 'echo',
        arguments: {},
      },
    }, CallToolResultSchema)

    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'legacy' })
    expect(result.structuredContent).toEqual({ mode: 'legacy' })
  })

  it('returns an error result for unknown tools', async () => {
    const dir = createTempDir()
    writeLegacyRuntimeConfig(dir, [])

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
    const result = await client.request({
      method: 'tools/call',
      params: {
        name: 'missing',
        arguments: {},
      },
    }, CallToolResultSchema)

    expect(result.isError).toBe(true)
    expect(result.content[0] && 'text' in result.content[0] ? result.content[0].text : '').toContain('Unknown tool: missing')
  })
})
