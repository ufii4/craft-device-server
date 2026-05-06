import { resolveDeviceServerConfigDir } from './runtime/config.ts'

export interface DeviceServerConfig {
  host: string
  port: number
  token: string
  runtimeConfigDir: string
  openaiApiKey?: string
  pexelsApiKey?: string
}

function parsePort(raw: string | undefined): number {
  if (!raw || raw.trim() === '') return 9797

  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`CRAFT_DEVICE_SERVER_PORT must be an integer between 0 and 65535. Received: ${raw}`)
  }

  return port
}

export function loadDeviceServerConfig(env: NodeJS.ProcessEnv = process.env): DeviceServerConfig {
  const token = env.CRAFT_DEVICE_SERVER_TOKEN?.trim()
  if (!token) {
    throw new Error('CRAFT_DEVICE_SERVER_TOKEN is required')
  }

  return {
    host: env.CRAFT_DEVICE_SERVER_HOST?.trim() || '127.0.0.1',
    port: parsePort(env.CRAFT_DEVICE_SERVER_PORT),
    token,
    runtimeConfigDir: resolveDeviceServerConfigDir(env),
    openaiApiKey: env.OPENAI_API_KEY?.trim() || undefined,
    pexelsApiKey: env.PEXELS_API_KEY?.trim() || undefined,
  }
}
