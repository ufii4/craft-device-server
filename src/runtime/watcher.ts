import { existsSync, mkdirSync, watch, type FSWatcher } from 'node:fs'
import { DeviceRuntimeRegistry, type RuntimeReloadResult } from './registry.ts'

const DEFAULT_DEBOUNCE_MS = 100

export interface DeviceRuntimeWatcherOptions {
  debounceMs?: number
  onReload?: (result: RuntimeReloadResult) => void | Promise<void>
}

export class DeviceRuntimeWatcher {
  private readonly registry: DeviceRuntimeRegistry
  private readonly options: DeviceRuntimeWatcherOptions
  private watcher: FSWatcher | null = null
  private reloadTimer: NodeJS.Timeout | null = null

  constructor(registry: DeviceRuntimeRegistry, options: DeviceRuntimeWatcherOptions = {}) {
    this.registry = registry
    this.options = options
  }

  start(): void {
    if (this.watcher) return

    const configDir = this.registry.getSnapshot().configDir
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }

    this.watcher = watch(configDir, { recursive: true }, () => {
      this.scheduleReload()
    })
  }

  stop(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer)
      this.reloadTimer = null
    }

    this.watcher?.close()
    this.watcher = null
  }

  private scheduleReload(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer)
    }

    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null
      void this.registry.reload().then(async (result) => {
        await this.options.onReload?.(result)
      })
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS)
  }
}
