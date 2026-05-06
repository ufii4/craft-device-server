import { z } from 'zod'
import { HTTP_METHODS, HTTP_ROUTE_AUTHS, type RuntimeConfigSnapshot } from './types.ts'

const inputSchema = z.record(z.string(), z.unknown())

export const handlerCommandSchema = z.object({
  command: z.string().trim().min(1, 'Handler command is required'),
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().max(300_000).default(30_000),
  cwd: z.string().trim().min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

const legacyHttpRouteSchema = z.object({
  id: z.string().trim().min(1, 'Route id is required'),
  method: z.enum(HTTP_METHODS),
  path: z.string().trim().min(1).refine((value) => value.startsWith('/'), {
    message: 'Route path must start with "/"',
  }),
  auth: z.enum(HTTP_ROUTE_AUTHS).default('none'),
  handler: handlerCommandSchema,
})

const legacyMcpToolSchema = z.object({
  name: z.string().trim().min(1, 'Tool name is required'),
  description: z.string().trim().min(1, 'Tool description is required'),
  inputSchema,
  handler: handlerCommandSchema,
})

export const httpRoutesFileSchema = z.object({
  routes: z.array(legacyHttpRouteSchema).default([]),
})

export const mcpToolsFileSchema = z.object({
  tools: z.array(legacyMcpToolSchema).default([]),
})

const commandArgvSchema = z.object({
  argv: z.array(z.string()).default([]),
}).default({ argv: [] })

export const operationConfigSchema = z.object({
  definition: z.string().trim().min(1, 'Operation definition path is required'),
  command: commandArgvSchema.optional().default({ argv: [] }),
})

const httpRouteExposureSchema = z.object({
  method: z.enum(HTTP_METHODS),
  path: z.string().trim().min(1).refine((value) => value.startsWith('/'), {
    message: 'Route path must start with "/"',
  }),
  operation: z.string().trim().min(1, 'HTTP route operation is required'),
  auth: z.enum(HTTP_ROUTE_AUTHS).default('none'),
})

const mcpDispatchSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('single-operation'),
    operation: z.string().trim().min(1, 'Dispatch operation is required'),
  }),
  z.object({
    kind: z.literal('field'),
    field: z.string().trim().min(1, 'Dispatch field is required'),
    operations: z.record(z.string(), z.string().trim().min(1)).refine((value) => Object.keys(value).length > 0, {
      message: 'Dispatch operations must not be empty',
    }),
  }),
])

const mcpTransportSchema = z.object({
  enabled: z.boolean().default(false),
  toolName: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  dispatch: mcpDispatchSchema.optional(),
})

const httpTransportSchema = z.object({
  enabled: z.boolean().default(false),
  routes: z.array(httpRouteExposureSchema).default([]),
})

export const toolConfigFileSchema = z.object({
  id: z.string().trim().min(1, 'Tool id is required'),
  name: z.string().trim().min(1, 'Tool name is required'),
  enabled: z.boolean().default(true),
  description: z.string().trim().default(''),
  handler: handlerCommandSchema,
  operations: z.record(z.string(), operationConfigSchema).refine((value) => Object.keys(value).length > 0, {
    message: 'Tool must define at least one operation',
  }),
  transports: z.object({
    mcp: mcpTransportSchema.optional().default({ enabled: false }),
    http: httpTransportSchema.optional().default({ enabled: false, routes: [] }),
  }).default({ mcp: { enabled: false }, http: { enabled: false, routes: [] } }),
})

export function validateRuntimeConfig(snapshot: RuntimeConfigSnapshot): RuntimeConfigSnapshot {
  const routeIds = new Set<string>()
  const routeKeys = new Set<string>()

  for (const route of snapshot.routes) {
    if (routeIds.has(route.id)) {
      throw new Error(`Duplicate HTTP route id: ${route.id}`)
    }
    routeIds.add(route.id)

    const routeKey = `${route.method} ${route.path}`
    if (routeKeys.has(routeKey)) {
      throw new Error(`Duplicate HTTP route binding: ${routeKey}`)
    }
    routeKeys.add(routeKey)
  }

  const toolIds = new Set<string>()
  for (const tool of snapshot.toolEntries) {
    if (toolIds.has(tool.id)) {
      throw new Error(`Duplicate tool id: ${tool.id}`)
    }
    toolIds.add(tool.id)
  }

  const toolNames = new Set<string>()
  for (const tool of snapshot.tools) {
    if (toolNames.has(tool.name)) {
      throw new Error(`Duplicate MCP tool name: ${tool.name}`)
    }
    toolNames.add(tool.name)
  }

  return snapshot
}
