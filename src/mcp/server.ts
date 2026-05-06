import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { errorResult } from './result.ts'
import { HandlerCommandError, runHandlerCommand } from '../runtime/run-handler-command.ts'
import type { DeviceRuntimeRegistry } from '../runtime/registry.ts'
import type {
  McpHandlerCommandResult,
  McpHandlerContentItem,
  McpHandlerPayload,
  OperationHandlerResult,
  OperationParseContext,
  RuntimeMcpToolConfig,
} from '../runtime/types.ts'

export interface DeviceMcpServerOptions {
  version: string
  registry: DeviceRuntimeRegistry
}

export interface DeviceMcpServer {
  handleRequest(req: IncomingMessage, res: ServerResponse, body?: unknown): Promise<void>
  close(): Promise<void>
}

interface SessionEntry {
  server: Server
  transport: StreamableHTTPServerTransport
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  return (body as Record<string, unknown>).method === 'initialize'
}

function writeJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  if (res.headersSent) return

  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  }))
}

function normalizeToolArguments(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return {}
  }
  return args as Record<string, unknown>
}

function normalizeLegacyHandlerResult(result: McpHandlerCommandResult): McpHandlerCommandResult {
  if (!Array.isArray(result.content) || result.content.some((item) => !item || typeof item !== 'object' || typeof item.type !== 'string')) {
    throw new Error('MCP handler result must include a content array with typed items')
  }

  if (result.structuredContent != null && (typeof result.structuredContent !== 'object' || Array.isArray(result.structuredContent))) {
    throw new Error('MCP handler structuredContent must be an object when provided')
  }

  return {
    content: result.content,
    structuredContent: result.structuredContent,
    isError: result.isError ?? false,
  }
}

function normalizeStructuredContent(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { value }
}

function toTextContent(text: string): McpHandlerContentItem[] {
  return [{ type: 'text', text }]
}

function normalizeOperationHandlerResult(result: OperationHandlerResult): McpHandlerCommandResult {
  if (!result.ok) {
    const message = result.error?.message || result.message || 'Operation failed'
    return {
      content: result.hints?.mcpContent ?? toTextContent(`[ERROR] ${message}`),
      structuredContent: normalizeStructuredContent(result.error?.details),
      isError: true,
    }
  }

  return {
    content: result.hints?.mcpContent ?? toTextContent(result.message || 'Operation completed'),
    structuredContent: result.hints?.suppressMcpStructuredContent ? undefined : normalizeStructuredContent(result.data),
    isError: false,
  }
}

function buildOperationParseContext(
  tool: Extract<RuntimeMcpToolConfig, { kind: 'tool' }>,
  operationId: string,
  args: Record<string, unknown>,
  version: string,
): OperationParseContext {
  return {
    toolId: tool.tool.id,
    operationId,
    trigger: 'mcp',
    mcp: {
      toolName: tool.name,
      arguments: args,
    },
    server: {
      version,
    },
  }
}

function resolveMcpOperation(
  tool: Extract<RuntimeMcpToolConfig, { kind: 'tool' }>,
  args: Record<string, unknown>,
): { operationId: string; rawInput: Record<string, unknown> } {
  if (tool.dispatch.kind === 'single-operation') {
    return {
      operationId: tool.dispatch.operation,
      rawInput: args,
    }
  }

  const rawValue = args[tool.dispatch.field]
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    throw new Error(`Missing MCP dispatch field: ${tool.dispatch.field}`)
  }

  const operationId = tool.dispatch.operations[rawValue]
  if (!operationId) {
    throw new Error(`Unknown operation selector for ${tool.name}: ${rawValue}`)
  }

  const rawInput = { ...args }
  delete rawInput[tool.dispatch.field]

  return { operationId, rawInput }
}

async function invokeLegacyTool(
  tool: Extract<RuntimeMcpToolConfig, { kind: 'legacy' }>,
  args: Record<string, unknown>,
  version: string,
): Promise<McpHandlerCommandResult> {
  const payload: McpHandlerPayload = {
    kind: 'mcp',
    tool: {
      name: tool.name,
      arguments: args,
    },
    server: {
      version,
    },
  }

  const result = await runHandlerCommand<McpHandlerCommandResult>(tool.handler, payload)
  return normalizeLegacyHandlerResult(result)
}

async function invokeToolFolderTool(
  tool: Extract<RuntimeMcpToolConfig, { kind: 'tool' }>,
  args: Record<string, unknown>,
  version: string,
): Promise<McpHandlerCommandResult> {
  const { operationId, rawInput } = resolveMcpOperation(tool, args)
  const operation = tool.tool.operations[operationId]
  if (!operation) {
    throw new Error(`Unknown operation: ${tool.tool.id}.${operationId}`)
  }

  const parseContext = buildOperationParseContext(tool, operationId, args, version)
  const input = await operation.definition.parse(rawInput, parseContext)

  const result = await runHandlerCommand<OperationHandlerResult>({
    ...tool.tool.handler,
    args: [...tool.tool.handler.args, ...operation.commandArgv],
  }, {
    kind: 'operation',
    tool: tool.tool.id,
    operation: operationId,
    input,
    context: {
      trigger: 'mcp',
      mcp: {
        toolName: tool.name,
        arguments: args,
      },
    },
    server: {
      version,
    },
  })

  return normalizeOperationHandlerResult(result)
}

function createProtocolServer(options: DeviceMcpServerOptions): Server {
  const server = new Server(
    {
      name: 'craft-device-server',
      version: options.version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: options.registry.listTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as {
          type: 'object'
          properties?: Record<string, unknown>
        },
      })),
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
    const { name, arguments: rawArgs } = request.params
    const tool = options.registry.getTool(name)
    if (!tool) {
      return errorResult(`Unknown tool: ${name}`)
    }

    const args = normalizeToolArguments(rawArgs)

    try {
      if (tool.kind === 'legacy') {
        return await invokeLegacyTool(tool, args, options.version)
      }

      return await invokeToolFolderTool(tool, args, options.version)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return errorResult(message)
    }
  })

  return server
}

export async function createDeviceMcpServer(
  options: DeviceMcpServerOptions,
): Promise<DeviceMcpServer> {
  const sessions = new Map<string, SessionEntry>()

  async function createSession(): Promise<SessionEntry> {
    let entry: SessionEntry | null = null

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        if (entry) {
          sessions.set(sessionId, entry)
        }
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId)
      },
    })

    const server = createProtocolServer(options)
    entry = { server, transport }

    transport.onclose = () => {
      const sessionId = transport.sessionId
      if (sessionId) {
        sessions.delete(sessionId)
      }
    }

    await server.connect(transport)
    return entry
  }

  return {
    async handleRequest(req: IncomingMessage, res: ServerResponse, body?: unknown) {
      const sessionId = getHeader(req, 'mcp-session-id')

      if (sessionId) {
        const entry = sessions.get(sessionId)
        if (!entry) {
          writeJsonRpcError(res, 404, -32001, 'Session not found')
          return
        }

        await entry.transport.handleRequest(req, res, body as any)
        return
      }

      if (req.method === 'POST' && isInitializeRequest(body)) {
        const entry = await createSession()
        await entry.transport.handleRequest(req, res, body as any)
        return
      }

      if (req.method === 'GET') {
        writeJsonRpcError(res, 400, -32000, 'Invalid or missing session ID')
        return
      }

      if (req.method === 'DELETE') {
        writeJsonRpcError(res, 400, -32000, 'Invalid or missing session ID')
        return
      }

      writeJsonRpcError(res, 400, -32000, 'Bad Request: No valid session ID provided')
    },
    async close() {
      const entries = [...sessions.values()]
      sessions.clear()

      for (const entry of entries) {
        await entry.transport.close().catch(() => {})
        await entry.server.close().catch(() => {})
      }
    },
  }
}
