#!/usr/bin/env bun
import packageJson from '../package.json'
import { loadDeviceServerConfig } from './config.ts'
import { startDeviceServer } from './server.ts'

async function main(): Promise<void> {
  const config = loadDeviceServerConfig()
  const server = await startDeviceServer({
    config,
    version: packageJson.version,
  })

  console.log(`CRAFT_DEVICE_SERVER_URL=${server.url}`)
  console.log(`CRAFT_DEVICE_SERVER_MCP_URL=${server.mcpUrl}`)
  console.log(`Craft Device Server listening on ${server.url}`)

  const shutdown = async () => {
    await server.close().catch(() => {})
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error('[device-server] Failed to start:', error)
  process.exit(1)
})
