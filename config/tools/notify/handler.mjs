import { spawn } from 'node:child_process'

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

  if (payload.kind !== 'operation') {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: { message: 'Expected operation handler payload' },
    }))
    return
  }

  if (payload.tool !== 'notify' || payload.operation !== 'send') {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: { message: `Unsupported operation: ${payload.tool}.${payload.operation}` },
    }))
    return
  }

  const input = payload.input && typeof payload.input === 'object' ? payload.input : {}
  const title = typeof input.title === 'string' ? input.title : 'Craft Device Server'
  const body = typeof input.body === 'string' ? input.body : 'Hello World'

  try {
    await runCommand('/usr/bin/osascript', [
      '-e',
      buildDisplayNotificationScript({ title, body }),
    ])

    process.stdout.write(JSON.stringify({
      ok: true,
      data: {
        title,
        body,
      },
    }))
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: {
        message: `Failed to send notification: ${error instanceof Error ? error.message : String(error)}`,
      },
      hints: {
        httpStatus: 500,
      },
    }))
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
