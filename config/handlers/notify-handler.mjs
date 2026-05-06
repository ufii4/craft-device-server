import { spawn } from 'node:child_process'

const NOTIFICATION_TITLE = 'Craft Device Server'
const NOTIFICATION_BODY = 'Hello World'

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8').trim()
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      reject(new Error(stderr.trim() || `Command failed with exit code ${code}`))
    })
  })
}

function escapeAppleScriptString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function buildDisplayNotificationScript(payload) {
  const title = escapeAppleScriptString(payload.title)
  const body = escapeAppleScriptString(payload.body)
  return `display notification "${body}" with title "${title}"`
}

async function main() {
  const raw = await readStdin()
  const payload = raw ? JSON.parse(raw) : {}

  if (payload.kind !== 'http') {
    process.stdout.write(JSON.stringify({
      status: 400,
      body: { error: 'Expected http handler payload' },
    }))
    return
  }

  try {
    await runCommand('/usr/bin/osascript', [
      '-e',
      buildDisplayNotificationScript({
        title: NOTIFICATION_TITLE,
        body: NOTIFICATION_BODY,
      }),
    ])

    process.stdout.write(JSON.stringify({
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: {
        ok: true,
        title: NOTIFICATION_TITLE,
        body: NOTIFICATION_BODY,
      },
    }))
  } catch (error) {
    process.stdout.write(JSON.stringify({
      status: 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: {
        error: `Failed to send notification: ${error instanceof Error ? error.message : String(error)}`,
      },
    }))
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
