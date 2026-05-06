import { runCommand } from '../exec/spawn.ts'
import type { NotificationPayload, NotificationService } from './service.ts'

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function buildDisplayNotificationScript(payload: NotificationPayload): string {
  const title = escapeAppleScriptString(payload.title)
  const body = escapeAppleScriptString(payload.body)
  return `display notification "${body}" with title "${title}"`
}

export function createMacOsNotificationService(): NotificationService {
  return {
    async notify(payload) {
      await runCommand('/usr/bin/osascript', [
        '-e',
        buildDisplayNotificationScript(payload),
      ])
    },
  }
}
