import { spawn } from 'node:child_process'
import type { HandlerCommandConfig, HandlerCommandPayload } from './types.ts'

export class HandlerCommandError extends Error {
  readonly stderr: string
  readonly stdout: string
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly timedOut: boolean

  constructor(
    message: string,
    details: {
      stderr?: string
      stdout?: string
      exitCode?: number | null
      signal?: NodeJS.Signals | null
      timedOut?: boolean
    } = {},
  ) {
    super(message)
    this.name = 'HandlerCommandError'
    this.stderr = details.stderr ?? ''
    this.stdout = details.stdout ?? ''
    this.exitCode = details.exitCode ?? null
    this.signal = details.signal ?? null
    this.timedOut = details.timedOut ?? false
  }
}

export async function runHandlerCommand<TResult>(
  handler: HandlerCommandConfig,
  payload: HandlerCommandPayload,
): Promise<TResult> {
  const stdin = JSON.stringify(payload)

  return await new Promise<TResult>((resolve, reject) => {
    const child = spawn(handler.command, handler.args, {
      cwd: handler.cwd,
      env: {
        ...process.env,
        ...handler.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const finishWithError = (error: HandlerCommandError) => {
      if (settled) return
      settled = true
      reject(error)
    }

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, handler.timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      finishWithError(new HandlerCommandError(
        `Failed to start handler command: ${error.message}`,
        { stdout, stderr },
      ))
    })

    child.on('close', (code, signal) => {
      clearTimeout(timeout)

      if (timedOut) {
        finishWithError(new HandlerCommandError(
          `Handler command timed out after ${handler.timeoutMs}ms`,
          { stdout, stderr, exitCode: code, signal, timedOut: true },
        ))
        return
      }

      if (code !== 0) {
        finishWithError(new HandlerCommandError(
          stderr.trim() || `Handler command exited with code ${code}`,
          { stdout, stderr, exitCode: code, signal },
        ))
        return
      }

      const trimmed = stdout.trim()
      if (!trimmed) {
        finishWithError(new HandlerCommandError('Handler command returned no stdout', {
          stdout,
          stderr,
          exitCode: code,
          signal,
        }))
        return
      }

      try {
        resolve(JSON.parse(trimmed) as TResult)
      } catch (error) {
        finishWithError(new HandlerCommandError(
          `Handler command returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          { stdout, stderr, exitCode: code, signal },
        ))
      }
    })

    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
  })
}
