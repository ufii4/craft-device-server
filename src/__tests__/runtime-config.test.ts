import { afterEach, describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDeviceServerConfig } from '../config.ts'
import {
  getDefaultDeviceServerConfigDir,
  loadDeviceServerRuntimeConfig,
  prepareDeviceServerRuntimeConfigDir,
  resolveDeviceServerConfigDir,
} from '../runtime/config.ts'
import { HandlerCommandError, runHandlerCommand } from '../runtime/run-handler-command.ts'

const TEMP_DIRS: string[] = []

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'device-server-runtime-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

function writeLegacyRuntimeConfig(
  dir: string,
  config: {
    routes?: unknown[]
    tools?: unknown[]
  },
): void {
  mkdirSync(join(dir, 'handlers'), { recursive: true })
  writeFileSync(join(dir, 'http-routes.json'), JSON.stringify({ routes: config.routes ?? [] }, null, 2))
  writeFileSync(join(dir, 'mcp-tools.json'), JSON.stringify({ tools: config.tools ?? [] }, null, 2))
}

function writeLegacyHandler(dir: string, name: string, source: string): string {
  const path = join(dir, 'handlers', name)
  writeFileSync(path, source)
  return path
}

function writeToolFolderConfig(
  dir: string,
  toolId: string,
  config: Record<string, unknown>,
  files: Record<string, string>,
): void {
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

describe('runtime config directory resolution', () => {
  it('uses the shared user config root by default', () => {
    const dir = createTempDir()
    const configRoot = join(dir, '.craft-agent')

    const configDir = resolveDeviceServerConfigDir({
      CRAFT_CONFIG_DIR: configRoot,
    } as NodeJS.ProcessEnv)

    expect(configDir).toBe(join(configRoot, 'device-server'))
  })

  it('prioritizes CRAFT_DEVICE_SERVER_CONFIG_DIR over the shared config root', () => {
    const dir = createTempDir()
    const configRoot = join(dir, '.craft-agent')
    const explicitDir = join(dir, 'explicit-device-server')

    const configDir = resolveDeviceServerConfigDir({
      CRAFT_CONFIG_DIR: configRoot,
      CRAFT_DEVICE_SERVER_CONFIG_DIR: explicitDir,
    } as NodeJS.ProcessEnv)

    expect(configDir).toBe(explicitDir)
  })

  it('migrates legacy package-local config and tool folders into the user-scoped config dir when needed', () => {
    const dir = createTempDir()
    const configRoot = join(dir, '.craft-agent')
    const legacyDir = join(dir, 'legacy-config')
    mkdirSync(join(legacyDir, 'handlers'), { recursive: true })
    mkdirSync(join(legacyDir, 'tools', 'images', 'operations'), { recursive: true })

    writeFileSync(join(legacyDir, 'http-routes.json'), JSON.stringify({
      routes: [{
        id: 'legacy-route',
        method: 'POST',
        path: '/legacy',
        auth: 'none',
        handler: { command: process.execPath, args: ['./handlers/legacy-route.mjs'], timeoutMs: 1000 },
      }],
    }, null, 2))
    writeFileSync(join(legacyDir, 'mcp-tools.json'), JSON.stringify({
      tools: [{
        name: 'legacy-tool',
        description: 'Legacy tool',
        inputSchema: { type: 'object' },
        handler: { command: process.execPath, args: ['./handlers/legacy-tool.mjs'], timeoutMs: 1000 },
      }],
    }, null, 2))
    writeFileSync(join(legacyDir, 'handlers', 'legacy-route.mjs'), 'process.stdout.write(JSON.stringify({ status: 200 }))')
    writeFileSync(join(legacyDir, 'handlers', 'legacy-tool.mjs'), 'process.stdout.write(JSON.stringify({ content: [{ type: "text", text: "ok" }] }))')
    writeFileSync(join(legacyDir, 'tools', 'images', 'config.json'), JSON.stringify({
      id: 'images',
      name: 'Images',
      enabled: true,
      description: 'Images tool',
      handler: { command: process.execPath, args: ['./handler.mjs'], timeoutMs: 1000 },
      operations: {
        search: { definition: './operations/search.definition.mjs', command: { argv: ['search'] } },
      },
      transports: {
        mcp: { enabled: true, toolName: 'images', description: 'Images tool', dispatch: { kind: 'single-operation', operation: 'search' } },
        http: { enabled: false, routes: [] },
      },
    }, null, 2))
    writeFileSync(join(legacyDir, 'tools', 'images', 'handler.mjs'), 'process.stdout.write(JSON.stringify({ ok: true }))')
    writeFileSync(join(legacyDir, 'tools', 'images', 'operations', 'search.definition.mjs'), 'export async function parse(input){ return input ?? {} }')

    const targetDir = getDefaultDeviceServerConfigDir({
      CRAFT_CONFIG_DIR: configRoot,
    } as NodeJS.ProcessEnv)

    prepareDeviceServerRuntimeConfigDir(targetDir, { legacyConfigDir: legacyDir })

    expect(existsSync(join(targetDir, 'http-routes.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'mcp-tools.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'handlers', 'legacy-route.mjs'))).toBe(true)
    expect(existsSync(join(targetDir, 'tools', 'images', 'config.json'))).toBe(true)
    expect(existsSync(join(targetDir, 'tools', 'images', 'operations', 'search.definition.mjs'))).toBe(true)
  })

  it('fills missing handler files from legacy config without overwriting existing handlers', () => {
    const dir = createTempDir()
    const configRoot = join(dir, '.craft-agent')
    const legacyDir = join(dir, 'legacy-config')
    const targetDir = getDefaultDeviceServerConfigDir({
      CRAFT_CONFIG_DIR: configRoot,
    } as NodeJS.ProcessEnv)

    mkdirSync(join(legacyDir, 'handlers'), { recursive: true })
    mkdirSync(join(targetDir, 'handlers'), { recursive: true })

    writeFileSync(join(legacyDir, 'handlers', 'existing-handler.mjs'), 'legacy-existing-handler')
    writeFileSync(join(legacyDir, 'handlers', 'missing-handler.mjs'), 'legacy-missing-handler')
    writeFileSync(join(targetDir, 'handlers', 'existing-handler.mjs'), 'target-existing-handler')

    prepareDeviceServerRuntimeConfigDir(targetDir, { legacyConfigDir: legacyDir })

    expect(readFileSync(join(targetDir, 'handlers', 'existing-handler.mjs'), 'utf8')).toBe('target-existing-handler')
    expect(readFileSync(join(targetDir, 'handlers', 'missing-handler.mjs'), 'utf8')).toBe('legacy-missing-handler')
  })

  it('wires the resolved runtime config dir into device server config loading', () => {
    const dir = createTempDir()
    const configRoot = join(dir, '.craft-agent')

    const config = loadDeviceServerConfig({
      CRAFT_DEVICE_SERVER_TOKEN: 'token',
      CRAFT_CONFIG_DIR: configRoot,
    } as NodeJS.ProcessEnv)

    expect(config.runtimeConfigDir).toBe(join(configRoot, 'device-server'))
  })
})

describe('runtime config loading', () => {
  it('loads valid tool-folder HTTP route config', async () => {
    const dir = createTempDir()
    writeToolFolderConfig(dir, 'echo', {
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
              auth: 'bearer',
            },
          ],
        },
      },
    }, {
      'handler.mjs': 'process.stdout.write(JSON.stringify({ ok: true }))',
      'operations/send.definition.mjs': `
        export async function parse(rawInput) {
          return { ...(rawInput && typeof rawInput === 'object' ? rawInput : {}) }
        }
        export const metadata = { inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }
      `,
    })

    const snapshot = await loadDeviceServerRuntimeConfig(dir)
    expect(snapshot.mode).toBe('tool-folders')
    expect(snapshot.routes).toHaveLength(1)
    const route = snapshot.routes[0]
    expect(route).toBeDefined()
    if (!route) throw new Error('Expected route')
    expect(route.kind).toBe('tool')
    if (route.kind !== 'tool') throw new Error('Expected tool route')
    expect(route.path).toBe('/echo')
    expect(route.operation.definitionPath).toBe(join(dir, 'tools', 'echo', 'operations', 'send.definition.mjs'))
    expect(route.tool.handler.args[0]).toBe(join(dir, 'tools', 'echo', 'handler.mjs'))
  })

  it('loads valid tool-folder MCP config for multi-operation tools', async () => {
    const dir = createTempDir()
    writeToolFolderConfig(dir, 'images', {
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
      'handler.mjs': 'process.stdout.write(JSON.stringify({ ok: true }))',
      'operations/search.definition.mjs': `
        export async function parse(rawInput) { return rawInput }
        export const metadata = { inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }
      `,
      'operations/edit.definition.mjs': `
        export async function parse(rawInput) { return rawInput }
        export const metadata = { inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } }
      `,
    })

    const snapshot = await loadDeviceServerRuntimeConfig(dir)
    expect(snapshot.mode).toBe('tool-folders')
    expect(snapshot.tools).toHaveLength(1)
    const tool = snapshot.tools[0]
    expect(tool).toBeDefined()
    if (!tool) throw new Error('Expected MCP tool')
    expect(tool.kind).toBe('tool')
    if (tool.kind !== 'tool') throw new Error('Expected tool MCP config')
    expect(tool.name).toBe('images')
    expect(JSON.stringify(tool.inputSchema)).toContain('method')
    expect(JSON.stringify(tool.inputSchema)).toContain('query')
    expect(JSON.stringify(tool.inputSchema)).toContain('prompt')
  })

  it('loads mixed tool-folder and legacy config with tool-folder precedence on conflicts', async () => {
    const dir = createTempDir()
    writeToolFolderConfig(dir, 'notify', {
      id: 'notify',
      name: 'Notify',
      enabled: true,
      description: 'Notify tool',
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
          toolName: 'images',
          description: 'Tool-folder images replacement',
          dispatch: { kind: 'single-operation', operation: 'send' },
        },
        http: {
          enabled: true,
          routes: [
            {
              method: 'POST',
              path: '/notify',
              operation: 'send',
              auth: 'bearer',
            },
          ],
        },
      },
    }, {
      'handler.mjs': 'process.stdout.write(JSON.stringify({ ok: true }))',
      'operations/send.definition.mjs': 'export async function parse(rawInput) { return rawInput ?? {} } export const metadata = { inputSchema: { type: "object" } }',
    })

    writeLegacyRuntimeConfig(dir, {
      routes: [
        {
          id: 'legacy-only-route',
          method: 'POST',
          path: '/legacy',
          auth: 'none',
          handler: {
            command: process.execPath,
            args: ['./handlers/legacy-route.mjs'],
            timeoutMs: 1000,
          },
        },
        {
          id: 'notify',
          method: 'POST',
          path: '/notify',
          auth: 'none',
          handler: {
            command: process.execPath,
            args: ['./handlers/conflict-route.mjs'],
            timeoutMs: 1000,
          },
        },
      ],
      tools: [
        {
          name: 'legacy-only-tool',
          description: 'Legacy only tool',
          inputSchema: { type: 'object' },
          handler: {
            command: process.execPath,
            args: ['./handlers/legacy-tool.mjs'],
            timeoutMs: 1000,
          },
        },
        {
          name: 'images',
          description: 'Conflicting legacy tool',
          inputSchema: { type: 'object' },
          handler: {
            command: process.execPath,
            args: ['./handlers/conflict-tool.mjs'],
            timeoutMs: 1000,
          },
        },
      ],
    })
    writeLegacyHandler(dir, 'legacy-route.mjs', 'process.stdout.write(JSON.stringify({ ok: true }))')
    writeLegacyHandler(dir, 'conflict-route.mjs', 'process.stdout.write(JSON.stringify({ ok: true }))')
    writeLegacyHandler(dir, 'legacy-tool.mjs', 'process.stdout.write(JSON.stringify({ ok: true }))')
    writeLegacyHandler(dir, 'conflict-tool.mjs', 'process.stdout.write(JSON.stringify({ ok: true }))')

    const snapshot = await loadDeviceServerRuntimeConfig(dir)
    expect(snapshot.mode).toBe('mixed')
    expect(snapshot.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'POST /notify',
      'POST /legacy',
    ])
    expect(snapshot.routes.find((route) => route.path === '/notify')?.kind).toBe('tool')
    expect(snapshot.tools.map((tool) => tool.name)).toEqual([
      'images',
      'legacy-only-tool',
    ])
    expect(snapshot.tools.find((tool) => tool.name === 'images')?.kind).toBe('tool')
  })

  it('falls back to legacy central config when no tool folders exist', async () => {
    const dir = createTempDir()
    writeLegacyRuntimeConfig(dir, {
      routes: [
        {
          id: 'echo',
          method: 'POST',
          path: '/echo',
          auth: 'bearer',
          handler: {
            command: process.execPath,
            args: ['./handlers/echo.mjs'],
            timeoutMs: 1000,
          },
        },
      ],
      tools: [
        {
          name: 'echo',
          description: 'Echo tool',
          inputSchema: { type: 'object' },
          handler: {
            command: process.execPath,
            args: ['./handlers/echo.mjs'],
            timeoutMs: 1000,
          },
        },
      ],
    })
    writeLegacyHandler(dir, 'echo.mjs', 'process.stdout.write(JSON.stringify({ ok: true }))')

    const snapshot = await loadDeviceServerRuntimeConfig(dir)
    expect(snapshot.mode).toBe('legacy')
    expect(snapshot.routes).toHaveLength(1)
    expect(snapshot.tools).toHaveLength(1)
    expect(snapshot.routes[0]?.kind).toBe('legacy')
    expect(snapshot.tools[0]?.kind).toBe('legacy')
  })

  it('rejects duplicate MCP tool names across tool folders', async () => {
    const dir = createTempDir()
    const sharedFiles = {
      'handler.mjs': 'process.stdout.write(JSON.stringify({ ok: true }))',
      'operations/send.definition.mjs': 'export async function parse(rawInput) { return rawInput ?? {} }',
    }

    writeToolFolderConfig(dir, 'alpha', {
      id: 'alpha',
      name: 'Alpha',
      enabled: true,
      description: 'Alpha tool',
      handler: { command: process.execPath, args: ['./handler.mjs'], timeoutMs: 1000 },
      operations: { send: { definition: './operations/send.definition.mjs', command: { argv: ['send'] } } },
      transports: { mcp: { enabled: true, toolName: 'dup', description: 'Duplicate', dispatch: { kind: 'single-operation', operation: 'send' } }, http: { enabled: false, routes: [] } },
    }, sharedFiles)

    writeToolFolderConfig(dir, 'beta', {
      id: 'beta',
      name: 'Beta',
      enabled: true,
      description: 'Beta tool',
      handler: { command: process.execPath, args: ['./handler.mjs'], timeoutMs: 1000 },
      operations: { send: { definition: './operations/send.definition.mjs', command: { argv: ['send'] } } },
      transports: { mcp: { enabled: true, toolName: 'dup', description: 'Duplicate', dispatch: { kind: 'single-operation', operation: 'send' } }, http: { enabled: false, routes: [] } },
    }, sharedFiles)

    await expect(loadDeviceServerRuntimeConfig(dir)).rejects.toThrow('Duplicate MCP tool name: dup')
  })

  it('rejects tool routes that reference unknown operations', async () => {
    const dir = createTempDir()
    writeToolFolderConfig(dir, 'broken', {
      id: 'broken',
      name: 'Broken',
      enabled: true,
      description: 'Broken tool',
      handler: { command: process.execPath, args: ['./handler.mjs'], timeoutMs: 1000 },
      operations: { send: { definition: './operations/send.definition.mjs', command: { argv: ['send'] } } },
      transports: {
        mcp: { enabled: false },
        http: { enabled: true, routes: [{ method: 'POST', path: '/broken', operation: 'missing', auth: 'none' }] },
      },
    }, {
      'handler.mjs': 'process.stdout.write(JSON.stringify({ ok: true }))',
      'operations/send.definition.mjs': 'export async function parse(rawInput) { return rawInput ?? {} }',
    })

    await expect(loadDeviceServerRuntimeConfig(dir)).rejects.toThrow('HTTP route references unknown operation broken.missing')
  })

  it('rejects tool folders with missing handler files', async () => {
    const dir = createTempDir()
    writeToolFolderConfig(dir, 'missing-handler', {
      id: 'missing-handler',
      name: 'Missing Handler',
      enabled: true,
      description: 'Missing handler tool',
      handler: { command: process.execPath, args: ['./handler.mjs'], timeoutMs: 1000 },
      operations: { send: { definition: './operations/send.definition.mjs', command: { argv: ['send'] } } },
      transports: {
        mcp: { enabled: true, toolName: 'missing-handler', description: 'Missing handler', dispatch: { kind: 'single-operation', operation: 'send' } },
        http: { enabled: false, routes: [] },
      },
    }, {
      'operations/send.definition.mjs': 'export async function parse(rawInput) { return rawInput ?? {} }',
    })

    await expect(loadDeviceServerRuntimeConfig(dir)).rejects.toThrow(`Missing handler file for tool missing-handler: ${join(dir, 'tools', 'missing-handler', 'handler.mjs')}`)
  })
})

describe('runHandlerCommand', () => {
  it('sends JSON to stdin and parses JSON stdout', async () => {
    const dir = createTempDir()
    const script = join(dir, 'echo.mjs')
    writeFileSync(script, `
      const chunks = []
      for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      process.stdout.write(JSON.stringify({ received: payload }))
    `)

    const result = await runHandlerCommand<{ received: { kind: string } }>(
      { command: process.execPath, args: [script], timeoutMs: 1000 },
      { kind: 'operation', tool: 'echo', operation: 'send', input: {}, context: { trigger: 'http' }, server: { version: 'test' } },
    )

    expect(result.received.kind).toBe('operation')
  })

  it('returns error on invalid JSON stdout', async () => {
    const dir = createTempDir()
    const script = join(dir, 'invalid-json.mjs')
    writeFileSync(script, 'process.stdout.write("not json")')

    await expect(runHandlerCommand(
      { command: process.execPath, args: [script], timeoutMs: 1000 },
      { kind: 'mcp', tool: { name: 'echo', arguments: {} }, server: { version: 'test' } },
    )).rejects.toThrow('Handler command returned invalid JSON')
  })

  it('returns error on non-zero exit', async () => {
    const dir = createTempDir()
    const script = join(dir, 'non-zero.mjs')
    writeFileSync(script, 'console.error("boom"); process.exit(2)')

    await expect(runHandlerCommand(
      { command: process.execPath, args: [script], timeoutMs: 1000 },
      { kind: 'mcp', tool: { name: 'echo', arguments: {} }, server: { version: 'test' } },
    )).rejects.toThrow('boom')
  })

  it('returns error on timeout', async () => {
    const dir = createTempDir()
    const script = join(dir, 'timeout.mjs')
    writeFileSync(script, 'await new Promise((resolve) => setTimeout(resolve, 500)); process.stdout.write(JSON.stringify({ ok: true }))')

    try {
      await runHandlerCommand(
        { command: process.execPath, args: [script], timeoutMs: 50 },
        { kind: 'mcp', tool: { name: 'echo', arguments: {} }, server: { version: 'test' } },
      )
      throw new Error('Expected timeout')
    } catch (error) {
      expect(error).toBeInstanceOf(HandlerCommandError)
      expect((error as HandlerCommandError).timedOut).toBe(true)
    }
  })
})
