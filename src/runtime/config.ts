import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import {
  httpRoutesFileSchema,
  mcpToolsFileSchema,
  toolConfigFileSchema,
  validateRuntimeConfig,
} from './validate.ts'
import type {
  HandlerCommandConfig,
  LegacyHttpRouteConfig,
  LegacyMcpToolConfig,
  McpDispatchConfig,
  OperationDefinitionModule,
  RuntimeConfigSnapshot,
  ToolHttpRouteConfig,
  ToolMcpToolConfig,
  ToolOperationRuntimeConfig,
  ToolRuntimeConfig,
} from './types.ts'

const DEVICE_SERVER_CONFIG_DIR_NAME = 'device-server'
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const LEGACY_CONFIG_DIR = resolve(fileURLToPath(new URL('../../config/', import.meta.url)))
const HTTP_ROUTES_CONFIG_FILE = 'http-routes.json'
const MCP_TOOLS_CONFIG_FILE = 'mcp-tools.json'
const TOOLS_DIR_NAME = 'tools'
const MIGRATABLE_ENTRIES = [
  HTTP_ROUTES_CONFIG_FILE,
  MCP_TOOLS_CONFIG_FILE,
  'handlers',
  TOOLS_DIR_NAME,
] as const

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read ${path}: ${message}`)
  }
}

function resolveMaybeRelativePath(baseDir: string, value: string): string {
  if (isAbsolute(value)) return value
  if (value.startsWith('./') || value.startsWith('../')) {
    return resolve(baseDir, value)
  }
  return value
}

function resolveHandlerConfig(baseDir: string, handler: HandlerCommandConfig): HandlerCommandConfig {
  return {
    ...handler,
    command: resolveMaybeRelativePath(baseDir, handler.command),
    args: handler.args.map((arg) => resolveMaybeRelativePath(baseDir, arg)),
    cwd: handler.cwd ? resolveMaybeRelativePath(baseDir, handler.cwd) : undefined,
    env: {
      CRAFT_DEVICE_SERVER_PACKAGE_ROOT: PACKAGE_ROOT,
      ...handler.env,
    },
  }
}

function isRelativePath(value: string | undefined): boolean {
  return !!value && (value.startsWith('./') || value.startsWith('../'))
}

function validateResolvedHandlerReference(
  baseDir: string,
  rawHandler: HandlerCommandConfig,
  resolvedHandler: HandlerCommandConfig,
  context: string,
): void {
  const rawHandlerPath = rawHandler.args[0]
  if (!isRelativePath(rawHandlerPath)) {
    return
  }

  const resolvedHandlerPath = resolvedHandler.args[0] ?? resolveMaybeRelativePath(baseDir, rawHandlerPath as string)
  if (!existsSync(resolvedHandlerPath)) {
    throw new Error(`Missing handler file for ${context}: ${resolvedHandlerPath}`)
  }
}

function resolveCraftConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CRAFT_CONFIG_DIR?.trim()
  return configured ? resolve(configured) : join(homedir(), '.craft-agent')
}

export function getLegacyDeviceServerConfigDir(): string {
  return LEGACY_CONFIG_DIR
}

export function getDefaultDeviceServerConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(join(resolveCraftConfigDir(env), DEVICE_SERVER_CONFIG_DIR_NAME))
}

function copyMissingEntries(sourcePath: string, targetPath: string): void {
  if (!existsSync(sourcePath)) {
    return
  }

  const sourceStats = statSync(sourcePath)

  if (!existsSync(targetPath)) {
    cpSync(sourcePath, targetPath, { recursive: true })
    return
  }

  const targetStats = statSync(targetPath)
  if (sourceStats.isDirectory()) {
    if (!targetStats.isDirectory()) {
      return
    }

    mkdirSync(targetPath, { recursive: true })
    for (const entry of readdirSync(sourcePath)) {
      copyMissingEntries(join(sourcePath, entry), join(targetPath, entry))
    }
    return
  }

  if (!targetStats.isDirectory()) {
    return
  }
}

export function prepareDeviceServerRuntimeConfigDir(
  configDir: string,
  options: { legacyConfigDir?: string } = {},
): void {
  const legacyConfigDir = options.legacyConfigDir ?? LEGACY_CONFIG_DIR

  mkdirSync(configDir, { recursive: true })

  if (!existsSync(legacyConfigDir) || resolve(legacyConfigDir) === resolve(configDir)) {
    return
  }

  for (const entry of MIGRATABLE_ENTRIES) {
    const sourcePath = join(legacyConfigDir, entry)
    const targetPath = join(configDir, entry)
    copyMissingEntries(sourcePath, targetPath)
  }
}

export function resolveDeviceServerConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CRAFT_DEVICE_SERVER_CONFIG_DIR?.trim()
  if (configured) {
    return resolve(configured)
  }

  const defaultConfigDir = getDefaultDeviceServerConfigDir(env)
  prepareDeviceServerRuntimeConfigDir(defaultConfigDir)
  return defaultConfigDir
}

function listToolConfigPaths(configDir: string): string[] {
  const toolsDir = join(configDir, TOOLS_DIR_NAME)
  if (!existsSync(toolsDir)) {
    return []
  }

  return readdirSync(toolsDir)
    .map((entry) => join(toolsDir, entry))
    .filter((path) => existsSync(path) && statSync(path).isDirectory() && existsSync(join(path, 'config.json')))
    .map((path) => join(path, 'config.json'))
    .sort()
}

async function loadDefinitionModule(definitionPath: string): Promise<OperationDefinitionModule> {
  const version = existsSync(definitionPath) ? statSync(definitionPath).mtimeMs : Date.now()
  const moduleUrl = `${pathToFileURL(definitionPath).href}?v=${version}`
  const imported = await import(moduleUrl) as Partial<OperationDefinitionModule>

  if (typeof imported.parse !== 'function') {
    throw new Error(`Operation definition must export parse(rawInput, context): ${definitionPath}`)
  }

  return {
    parse: imported.parse.bind(imported),
    metadata: imported.metadata,
  }
}

function ensureObjectInput(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }
  return value as Record<string, unknown>
}

function buildMcpInputSchema(dispatch: McpDispatchConfig, tool: ToolRuntimeConfig): Record<string, unknown> {
  if (dispatch.kind === 'single-operation') {
    return tool.operations[dispatch.operation]?.definition.metadata?.inputSchema ?? {
      type: 'object',
      additionalProperties: true,
    }
  }

  const combinedProperties: Record<string, unknown> = {
    [dispatch.field]: {
      type: 'string',
      enum: Object.keys(dispatch.operations),
      description: `Operation selector for ${tool.name}`,
    },
  }
  const oneOf: Record<string, unknown>[] = []

  for (const [dispatchValue, operationId] of Object.entries(dispatch.operations)) {
    const operation = tool.operations[operationId]
    const schema = operation?.definition.metadata?.inputSchema
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      continue
    }

    const objectSchema = schema as Record<string, unknown>
    const properties = objectSchema.properties
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      Object.assign(combinedProperties, properties)
    }

    const required = Array.isArray(objectSchema.required)
      ? [...objectSchema.required.filter((value): value is string => typeof value === 'string'), dispatch.field]
      : [dispatch.field]

    oneOf.push({
      ...objectSchema,
      properties: {
        ...(properties && typeof properties === 'object' && !Array.isArray(properties) ? properties : {}),
        [dispatch.field]: { const: dispatchValue },
      },
      required,
    })
  }

  return {
    type: 'object',
    additionalProperties: false,
    properties: combinedProperties,
    required: [dispatch.field],
    ...(oneOf.length > 0 ? { oneOf } : {}),
  }
}

async function loadToolFolderRuntimeConfig(configDir: string, toolConfigPaths: string[]): Promise<RuntimeConfigSnapshot> {
  const toolEntries: ToolRuntimeConfig[] = []
  const routes: ToolHttpRouteConfig[] = []
  const tools: ToolMcpToolConfig[] = []

  for (const toolConfigPath of toolConfigPaths) {
    const baseDir = dirname(toolConfigPath)
    const parsed = toolConfigFileSchema.parse(readJsonFile(toolConfigPath))
    if (!parsed.enabled) {
      continue
    }

    const handler = resolveHandlerConfig(baseDir, parsed.handler)
    validateResolvedHandlerReference(baseDir, parsed.handler, handler, `tool ${parsed.id}`)
    const operations: Record<string, ToolOperationRuntimeConfig> = {}

    for (const [operationId, operationConfig] of Object.entries(parsed.operations)) {
      const definitionPath = resolveMaybeRelativePath(baseDir, operationConfig.definition)
      if (!existsSync(definitionPath)) {
        throw new Error(`Missing operation definition for ${parsed.id}.${operationId}: ${definitionPath}`)
      }

      operations[operationId] = {
        id: operationId,
        definitionPath,
        commandArgv: operationConfig.command?.argv ?? [],
        definition: await loadDefinitionModule(definitionPath),
      }
    }

    const toolRuntime: ToolRuntimeConfig = {
      id: parsed.id,
      name: parsed.name,
      description: parsed.description,
      baseDir,
      handler,
      operations,
    }

    if (parsed.transports.http?.enabled) {
      for (const route of parsed.transports.http.routes) {
        const operation = operations[route.operation]
        if (!operation) {
          throw new Error(`HTTP route references unknown operation ${parsed.id}.${route.operation}`)
        }

        routes.push({
          kind: 'tool',
          id: `${parsed.id}:${route.method}:${route.path}:${route.operation}`,
          method: route.method,
          path: route.path,
          auth: route.auth,
          tool: toolRuntime,
          operation,
        })
      }
    }

    if (parsed.transports.mcp?.enabled) {
      const mcpTransport = parsed.transports.mcp
      if (!mcpTransport.toolName) {
        throw new Error(`MCP transport for ${parsed.id} requires toolName`)
      }
      if (!mcpTransport.dispatch) {
        throw new Error(`MCP transport for ${parsed.id} requires dispatch configuration`)
      }

      if (mcpTransport.dispatch.kind === 'single-operation') {
        if (!operations[mcpTransport.dispatch.operation]) {
          throw new Error(`MCP dispatch references unknown operation ${parsed.id}.${mcpTransport.dispatch.operation}`)
        }
      } else {
        ensureObjectInput(mcpTransport.dispatch.operations, `MCP dispatch operations for ${parsed.id} must be an object`)
        for (const operationId of Object.values(mcpTransport.dispatch.operations)) {
          if (!operations[operationId]) {
            throw new Error(`MCP dispatch references unknown operation ${parsed.id}.${operationId}`)
          }
        }
      }

      tools.push({
        kind: 'tool',
        name: mcpTransport.toolName,
        description: mcpTransport.description ?? parsed.description ?? parsed.name,
        inputSchema: buildMcpInputSchema(mcpTransport.dispatch, toolRuntime),
        tool: toolRuntime,
        dispatch: mcpTransport.dispatch,
      })
    }

    toolEntries.push(toolRuntime)
  }

  return validateRuntimeConfig({
    configDir,
    mode: 'tool-folders',
    routes,
    tools,
    toolEntries,
  })
}

function loadLegacyRuntimeConfig(configDir: string): RuntimeConfigSnapshot {
  const routesPath = join(configDir, HTTP_ROUTES_CONFIG_FILE)
  const toolsPath = join(configDir, MCP_TOOLS_CONFIG_FILE)

  const parsedRoutes = existsSync(routesPath)
    ? httpRoutesFileSchema.parse(readJsonFile(routesPath))
    : { routes: [] }
  const parsedTools = existsSync(toolsPath)
    ? mcpToolsFileSchema.parse(readJsonFile(toolsPath))
    : { tools: [] }

  const routes: LegacyHttpRouteConfig[] = parsedRoutes.routes.map((route) => {
    const handler = resolveHandlerConfig(configDir, route.handler)
    validateResolvedHandlerReference(configDir, route.handler, handler, `legacy HTTP route ${route.id}`)

    return {
      kind: 'legacy',
      id: route.id,
      method: route.method,
      path: route.path,
      auth: route.auth,
      handler,
    }
  })

  const tools: LegacyMcpToolConfig[] = parsedTools.tools.map((tool) => {
    const handler = resolveHandlerConfig(configDir, tool.handler)
    validateResolvedHandlerReference(configDir, tool.handler, handler, `legacy MCP tool ${tool.name}`)

    return {
      kind: 'legacy',
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler,
    }
  })

  return validateRuntimeConfig({
    configDir,
    mode: 'legacy',
    routes,
    tools,
    toolEntries: [],
  })
}

function mergeRuntimeSnapshots(
  configDir: string,
  toolSnapshot: RuntimeConfigSnapshot | null,
  legacySnapshot: RuntimeConfigSnapshot | null,
): RuntimeConfigSnapshot {
  const routes = [...(toolSnapshot?.routes ?? [])]
  const routeIds = new Set(routes.map((route) => route.id))
  const routeBindings = new Set(routes.map((route) => `${route.method} ${route.path}`))

  for (const route of legacySnapshot?.routes ?? []) {
    const routeBinding = `${route.method} ${route.path}`
    if (routeIds.has(route.id) || routeBindings.has(routeBinding)) {
      continue
    }

    routes.push(route)
    routeIds.add(route.id)
    routeBindings.add(routeBinding)
  }

  const tools = [...(toolSnapshot?.tools ?? [])]
  const toolNames = new Set(tools.map((tool) => tool.name))

  for (const tool of legacySnapshot?.tools ?? []) {
    if (toolNames.has(tool.name)) {
      continue
    }

    tools.push(tool)
    toolNames.add(tool.name)
  }

  const toolEntries = [...(toolSnapshot?.toolEntries ?? [])]

  const hasToolFolderEntries = toolEntries.length > 0
  const hasLegacyEntries = (legacySnapshot?.routes.length ?? 0) > 0 || (legacySnapshot?.tools.length ?? 0) > 0

  return validateRuntimeConfig({
    configDir,
    mode: hasToolFolderEntries
      ? hasLegacyEntries ? 'mixed' : 'tool-folders'
      : 'legacy',
    routes,
    tools,
    toolEntries,
  })
}

export async function loadDeviceServerRuntimeConfig(configDir: string): Promise<RuntimeConfigSnapshot> {
  mkdirSync(configDir, { recursive: true })

  const toolConfigPaths = listToolConfigPaths(configDir)
  const toolSnapshot = toolConfigPaths.length > 0
    ? await loadToolFolderRuntimeConfig(configDir, toolConfigPaths)
    : null

  const routesPath = join(configDir, HTTP_ROUTES_CONFIG_FILE)
  const toolsPath = join(configDir, MCP_TOOLS_CONFIG_FILE)
  const hasLegacyFiles = existsSync(routesPath) || existsSync(toolsPath)
  const legacySnapshot = hasLegacyFiles
    ? loadLegacyRuntimeConfig(configDir)
    : null

  if (!toolSnapshot && !legacySnapshot) {
    return validateRuntimeConfig({
      configDir,
      mode: 'legacy',
      routes: [],
      tools: [],
      toolEntries: [],
    })
  }

  return mergeRuntimeSnapshots(configDir, toolSnapshot, legacySnapshot)
}

export function getRuntimeConfigPaths(configDir: string): {
  routesPath: string
  toolsPath: string
  toolConfigsGlobRoot: string
} {
  return {
    routesPath: join(configDir, HTTP_ROUTES_CONFIG_FILE),
    toolsPath: join(configDir, MCP_TOOLS_CONFIG_FILE),
    toolConfigsGlobRoot: join(configDir, TOOLS_DIR_NAME),
  }
}

export type ToolConfigFile = z.infer<typeof toolConfigFileSchema>
