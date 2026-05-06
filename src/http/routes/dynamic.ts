import { hasValidBearerToken } from '../auth.ts'
import { readRequestBody } from '../request-body.ts'
import {
  errorResponse,
  jsonResponse,
  methodNotAllowedResponse,
  unauthorizedResponse,
} from '../responses.ts'
import { HandlerCommandError, runHandlerCommand } from '../../runtime/run-handler-command.ts'
import type { DeviceRuntimeRegistry } from '../../runtime/registry.ts'
import type {
  HttpHandlerCommandResult,
  HttpHandlerPayload,
  OperationHandlerResult,
  OperationParseContext,
  RuntimeHttpRouteConfig,
} from '../../runtime/types.ts'

export interface DynamicHttpRouteHandlerOptions {
  token: string
  version: string
  registry: DeviceRuntimeRegistry
}

function collectHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

function collectQuery(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}

  for (const [key, value] of url.searchParams.entries()) {
    const existing = query[key]
    if (existing == null) {
      query[key] = value
      continue
    }

    query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
  }

  return query
}

function normalizeLegacyHandlerResponse(result: HttpHandlerCommandResult): Response {
  if (!Number.isInteger(result.status) || result.status < 100 || result.status > 599) {
    throw new Error('HTTP handler result must include a valid status code')
  }

  const headers = new Headers(result.headers)
  const body = result.body

  if (body == null) {
    return new Response(null, { status: result.status, headers })
  }

  if (typeof body === 'string') {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'text/plain; charset=utf-8')
    }
    return new Response(body, { status: result.status, headers })
  }

  return jsonResponse(body, { status: result.status, headers })
}

function normalizeOperationHandlerResponse(result: OperationHandlerResult): Response {
  const headers = new Headers(result.hints?.httpHeaders)

  if (!result.ok) {
    const message = result.error?.message || result.message || 'Operation failed'
    return jsonResponse({
      error: message,
      ...(result.error?.code ? { code: result.error.code } : {}),
      ...(result.error?.details !== undefined ? { details: result.error.details } : {}),
    }, {
      status: result.hints?.httpStatus ?? 500,
      headers,
    })
  }

  const status = result.hints?.httpStatus ?? 200
  if ((status === 204 || status === 205) && result.data === undefined && !result.message) {
    return new Response(null, { status, headers })
  }

  if (typeof result.data === 'string' && !result.message) {
    const contentType = headers.get('content-type')?.toLowerCase()
    if (contentType?.startsWith('text/plain')) {
      return new Response(result.data, { status, headers })
    }
  }

  let body: unknown
  if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    body = {
      ok: true,
      ...(result.data as Record<string, unknown>),
      ...(result.message ? { message: result.message } : {}),
    }
  } else if (result.data !== undefined) {
    body = {
      ok: true,
      data: result.data,
      ...(result.message ? { message: result.message } : {}),
    }
  } else if (result.message) {
    body = {
      ok: true,
      message: result.message,
    }
  } else {
    body = { ok: true }
  }

  return jsonResponse(body, {
    status,
    headers,
  })
}

function buildOperationContext(
  route: Extract<RuntimeHttpRouteConfig, { kind: 'tool' }>,
  req: Request,
  version: string,
  url: URL,
): OperationParseContext {
  return {
    toolId: route.tool.id,
    operationId: route.operation.id,
    trigger: 'http',
    request: {
      method: req.method,
      path: url.pathname,
      headers: collectHeaders(req),
      query: collectQuery(url),
    },
    server: {
      version,
    },
  }
}

function validateToolRouteTransport(req: Request): string | null {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return null
  }

  const contentType = req.headers.get('content-type')
  if (!contentType || contentType.includes('application/json')) {
    return null
  }

  return 'HTTP tool routes require application/json request bodies'
}

async function invokeLegacyHttpRoute(
  route: Extract<RuntimeHttpRouteConfig, { kind: 'legacy' }>,
  req: Request,
  version: string,
  url: URL,
): Promise<Response> {
  let body: unknown
  try {
    body = await readRequestBody(req)
  } catch (error) {
    return errorResponse(400, error instanceof Error ? error.message : String(error))
  }

  const payload: HttpHandlerPayload = {
    kind: 'http',
    request: {
      method: req.method,
      path: url.pathname,
      headers: collectHeaders(req),
      query: collectQuery(url),
      body,
    },
    server: {
      version,
    },
  }

  try {
    const result = await runHandlerCommand<HttpHandlerCommandResult>(route.handler, payload)
    return normalizeLegacyHandlerResponse(result)
  } catch (error) {
    const message = error instanceof HandlerCommandError ? error.message : String(error)
    return errorResponse(500, `Handler execution failed: ${message}`)
  }
}

async function invokeToolHttpRoute(
  route: Extract<RuntimeHttpRouteConfig, { kind: 'tool' }>,
  req: Request,
  version: string,
  url: URL,
): Promise<Response> {
  const transportError = validateToolRouteTransport(req)
  if (transportError) {
    return errorResponse(400, transportError)
  }

  let rawInput: unknown
  try {
    rawInput = await readRequestBody(req)
  } catch (error) {
    return errorResponse(400, error instanceof Error ? error.message : String(error))
  }

  const parseContext = buildOperationContext(route, req, version, url)

  let input: unknown
  try {
    input = await route.operation.definition.parse(rawInput, parseContext)
  } catch (error) {
    return errorResponse(400, `Invalid operation input: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const result = await runHandlerCommand<OperationHandlerResult>({
      ...route.tool.handler,
      args: [...route.tool.handler.args, ...route.operation.commandArgv],
    }, {
      kind: 'operation',
      tool: route.tool.id,
      operation: route.operation.id,
      input,
      context: {
        trigger: 'http',
        request: parseContext.request,
      },
      server: {
        version,
      },
    })

    return normalizeOperationHandlerResponse(result)
  } catch (error) {
    const message = error instanceof HandlerCommandError ? error.message : String(error)
    return errorResponse(500, `Handler execution failed: ${message}`)
  }
}

export async function handleDynamicHttpRoute(
  req: Request,
  options: DynamicHttpRouteHandlerOptions,
): Promise<Response> {
  const url = new URL(req.url)
  const route = options.registry.findHttpRoute(req.method, url.pathname)
  if (!route) {
    if (options.registry.hasHttpPath(url.pathname)) {
      const allowedMethods = options.registry.listHttpRoutes()
        .filter((entry) => entry.path === url.pathname)
        .map((entry) => entry.method)
      return methodNotAllowedResponse(allowedMethods)
    }
    return errorResponse(404, 'Not found')
  }

  if (route.auth === 'bearer' && !hasValidBearerToken(req.headers.get('authorization'), options.token)) {
    return unauthorizedResponse()
  }

  if (route.kind === 'legacy') {
    return await invokeLegacyHttpRoute(route, req, options.version, url)
  }

  return await invokeToolHttpRoute(route, req, options.version, url)
}
