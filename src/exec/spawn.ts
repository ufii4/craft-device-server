import { spawn } from 'node:child_process'

export interface SpawnCommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdin?: string
  timeoutMs?: number
}

export interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
}

export async function spawnCommand(
  command: string,
  args: string[],
  options: SpawnCommandOptions = {},
): Promise<SpawnResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs ?? 30_000)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      resolve({ stdout, stderr, exitCode: code, signal, timedOut })
    })

    child.stdin.on('error', () => {})
    child.stdin.end(options.stdin)
  })
}

export async function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await spawnCommand(command, args)
  if (result.timedOut) {
    throw new Error(`Command timed out: ${command} ${args.join(' ')}`)
  }

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() || `Command failed with exit code ${result.exitCode}: ${command} ${args.join(' ')}`,
    )
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  }
}
