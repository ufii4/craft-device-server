export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type HttpMethod = typeof HTTP_METHODS[number]

export const HTTP_ROUTE_AUTHS = ['none', 'bearer'] as const
export type HttpRouteAuth = typeof HTTP_ROUTE_AUTHS[number]

export interface HandlerCommandConfig {
  command: string
  args: string[]
  timeoutMs: number
  cwd?: string
  env?: Record<string, string>
}

export interface LegacyHttpRouteConfig {
  kind: 'legacy'
  id: string
  method: HttpMethod
  path: string
  auth: HttpRouteAuth
  handler: HandlerCommandConfig
}

export interface LegacyMcpToolConfig {
  kind: 'legacy'
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: HandlerCommandConfig
}

export interface OperationParseContext {
  toolId: string
  operationId: string
  trigger: 'http' | 'mcp'
  request?: {
    method?: string
    path?: string
    headers?: Record<string, string>
    query?: Record<string, string | string[]>
  }
  mcp?: {
    toolName: string
    arguments: Record<string, unknown>
  }
  server: {
    version: string
  }
}

export interface OperationMetadata {
  summary?: string
  description?: string
  inputSchema?: Record<string, unknown>
  mcp?: {
    title?: string
    examples?: Array<Record<string, unknown>>
  }
  http?: {
    examples?: Array<Record<string, unknown>>
  }
}

export interface OperationDefinitionModule {
  parse(rawInput: unknown, context: OperationParseContext): Promise<unknown> | unknown
  metadata?: OperationMetadata
}

export interface ToolOperationRuntimeConfig {
  id: string
  definitionPath: string
  commandArgv: string[]
  definition: OperationDefinitionModule
}

export interface ToolRuntimeConfig {
  id: string
  name: string
  description: string
  baseDir: string
  handler: HandlerCommandConfig
  operations: Record<string, ToolOperationRuntimeConfig>
}

export interface ToolHttpRouteConfig {
  kind: 'tool'
  id: string
  method: HttpMethod
  path: string
  auth: HttpRouteAuth
  tool: ToolRuntimeConfig
  operation: ToolOperationRuntimeConfig
}

export interface McpSingleOperationDispatchConfig {
  kind: 'single-operation'
  operation: string
}

export interface McpFieldDispatchConfig {
  kind: 'field'
  field: string
  operations: Record<string, string>
}

export type McpDispatchConfig = McpSingleOperationDispatchConfig | McpFieldDispatchConfig

export interface ToolMcpToolConfig {
  kind: 'tool'
  name: string
  description: string
  inputSchema: Record<string, unknown>
  tool: ToolRuntimeConfig
  dispatch: McpDispatchConfig
}

export type RuntimeHttpRouteConfig = LegacyHttpRouteConfig | ToolHttpRouteConfig
export type RuntimeMcpToolConfig = LegacyMcpToolConfig | ToolMcpToolConfig

export interface RuntimeConfigSnapshot {
  configDir: string
  mode: 'legacy' | 'tool-folders' | 'mixed'
  routes: RuntimeHttpRouteConfig[]
  tools: RuntimeMcpToolConfig[]
  toolEntries: ToolRuntimeConfig[]
}

export interface HttpHandlerPayload {
  kind: 'http'
  request: {
    method: string
    path: string
    headers: Record<string, string>
    query: Record<string, string | string[]>
    body?: unknown
  }
  server: {
    version: string
  }
}

export interface McpHandlerPayload {
  kind: 'mcp'
  tool: {
    name: string
    arguments: Record<string, unknown>
  }
  server: {
    version: string
  }
}

export interface OperationHandlerPayload {
  kind: 'operation'
  tool: string
  operation: string
  input: unknown
  context: {
    trigger: 'http' | 'mcp'
    request?: {
      method?: string
      path?: string
      headers?: Record<string, string>
      query?: Record<string, string | string[]>
    }
    mcp?: {
      toolName: string
      arguments: Record<string, unknown>
    }
  }
  server: {
    version: string
  }
}

export interface HttpHandlerCommandResult {
  status: number
  headers?: Record<string, string>
  body?: unknown
}

export interface McpHandlerContentItem {
  type: string
  [key: string]: unknown
}

export interface McpHandlerCommandResult {
  content: McpHandlerContentItem[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export interface OperationHandlerError {
  code?: string
  message: string
  details?: unknown
}

export interface OperationHandlerHints {
  httpStatus?: number
  httpHeaders?: Record<string, string>
  mcpContent?: McpHandlerContentItem[]
  suppressMcpStructuredContent?: boolean
}

export interface OperationHandlerResult {
  ok: boolean
  message?: string
  data?: unknown
  error?: OperationHandlerError
  hints?: OperationHandlerHints
}

export type HandlerCommandPayload = HttpHandlerPayload | McpHandlerPayload | OperationHandlerPayload
