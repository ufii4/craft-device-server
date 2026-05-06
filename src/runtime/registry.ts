import { loadDeviceServerRuntimeConfig } from './config.ts'
import type {
  RuntimeConfigSnapshot,
  RuntimeHttpRouteConfig,
  RuntimeMcpToolConfig,
} from './types.ts'

export interface RuntimeReloadResult {
  success: boolean
  snapshot: RuntimeConfigSnapshot
  error?: Error
}

function buildRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`
}

export class DeviceRuntimeRegistry {
  private snapshot: RuntimeConfigSnapshot
  private readonly routeMap = new Map<string, RuntimeHttpRouteConfig>()
  private readonly routePaths = new Set<string>()
  private readonly toolMap = new Map<string, RuntimeMcpToolConfig>()

  private constructor(snapshot: RuntimeConfigSnapshot) {
    this.snapshot = snapshot
    this.rebuildIndexes(snapshot)
  }

  static async load(configDir: string): Promise<DeviceRuntimeRegistry> {
    return new DeviceRuntimeRegistry(await loadDeviceServerRuntimeConfig(configDir))
  }

  getSnapshot(): RuntimeConfigSnapshot {
    return this.snapshot
  }

  listHttpRoutes(): RuntimeHttpRouteConfig[] {
    return [...this.snapshot.routes]
  }

  listTools(): RuntimeMcpToolConfig[] {
    return [...this.snapshot.tools]
  }

  findHttpRoute(method: string, path: string): RuntimeHttpRouteConfig | undefined {
    return this.routeMap.get(buildRouteKey(method, path))
  }

  hasHttpPath(path: string): boolean {
    return this.routePaths.has(path)
  }

  getTool(name: string): RuntimeMcpToolConfig | undefined {
    return this.toolMap.get(name)
  }

  async reload(): Promise<RuntimeReloadResult> {
    try {
      const nextSnapshot = await loadDeviceServerRuntimeConfig(this.snapshot.configDir)
      this.snapshot = nextSnapshot
      this.rebuildIndexes(nextSnapshot)
      return { success: true, snapshot: nextSnapshot }
    } catch (error) {
      return {
        success: false,
        snapshot: this.snapshot,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  private rebuildIndexes(snapshot: RuntimeConfigSnapshot): void {
    this.routeMap.clear()
    this.routePaths.clear()
    this.toolMap.clear()

    for (const route of snapshot.routes) {
      this.routeMap.set(buildRouteKey(route.method, route.path), route)
      this.routePaths.add(route.path)
    }

    for (const tool of snapshot.tools) {
      this.toolMap.set(tool.name, tool)
    }
  }
}
