import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Subprocess } from 'bun'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'

const SERVER_ENTRY = join(import.meta.dir, '..', 'index.ts')
const STARTUP_TIMEOUT = 15_000
const TOKEN = 'device-server-smoke-token'
const TEMP_DIRS: string[] = []

interface SpawnedServer {
  url: string
  mcpUrl: string
  proc: Subprocess
  stop(): Promise<void>
}

async function spawnTestServer(): Promise<SpawnedServer> {
  const configRoot = mkdtempSync(join(tmpdir(), 'device-server-smoke-config-'))
  TEMP_DIRS.push(configRoot)

  const proc = Bun.spawn(['bun', 'run', SERVER_ENTRY], {
    env: {
      ...process.env,
      CRAFT_DEVICE_SERVER_TOKEN: TOKEN,
      CRAFT_DEVICE_SERVER_HOST: '127.0.0.1',
      CRAFT_DEVICE_SERVER_PORT: '0',
      CRAFT_CONFIG_DIR: configRoot,
      OPENROUTER_API_KEY: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  return await new Promise<SpawnedServer>((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error(`Device server did not start within ${STARTUP_TIMEOUT}ms`))
    }, STARTUP_TIMEOUT)

    let url = ''
    let mcpUrl = ''
    let buffer = ''

    const processLines = () => {
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('CRAFT_DEVICE_SERVER_URL=')) {
          url = line.slice('CRAFT_DEVICE_SERVER_URL='.length).trim()
        }
        if (line.startsWith('CRAFT_DEVICE_SERVER_MCP_URL=')) {
          mcpUrl = line.slice('CRAFT_DEVICE_SERVER_MCP_URL='.length).trim()
        }

        if (url && mcpUrl) {
          clearTimeout(timer)
          resolve({
            url,
            mcpUrl,
            proc,
            async stop() {
              proc.kill('SIGTERM')
              await proc.exited
            },
          })
          return
        }
      }
    }

    ;(async () => {
      const reader = proc.stdout!.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          processLines()
        }
      } catch {
        // ignore stream teardown
      }

      clearTimeout(timer)
      if (!url || !mcpUrl) {
        reject(new Error('Device server exited before printing startup URLs'))
      }
    })()
  })
}

describe('device server smoke', () => {
  let server: SpawnedServer | null = null
  let transport: StreamableHTTPClientTransport | null = null

  afterEach(async () => {
    if (transport) {
      await transport.close().catch(() => {})
      transport = null
    }
    if (server) {
      await server.stop().catch(() => {})
      server = null
    }
    while (TEMP_DIRS.length > 0) {
      const dir = TEMP_DIRS.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('starts, serves health, and exposes seeded MCP/HTTP tools', async () => {
    server = await spawnTestServer()

    const healthResponse = await fetch(`${server.url}/health`)
    expect(healthResponse.status).toBe(200)
    expect(await healthResponse.json()).toEqual({
      status: 'ok',
      service: 'craft-device-server',
    })

    const trollResponse = await fetch(`${server.url}/troll`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'hello there' }),
    })
    expect(trollResponse.status).toBe(204)
    expect(await trollResponse.text()).toBe('')

    const client = new Client({ name: 'device-server-smoke-client', version: '1.0.0' })
    transport = new StreamableHTTPClientTransport(new URL(server.mcpUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
        },
      },
    })
    await client.connect(transport)

    const tools = await client.request({
      method: 'tools/list',
      params: {},
    }, ListToolsResultSchema)

    const toolNames = tools.tools.map((tool) => tool.name)
    expect(toolNames).toContain('images')
    expect(toolNames).toContain('troll')
  })
})
