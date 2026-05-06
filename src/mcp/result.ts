export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export function successResult(text: string, structuredContent: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
    isError: false,
  }
}

export function errorResult(message: string, structuredContent: Record<string, unknown> = {}): ToolResult {
  return {
    content: [{ type: 'text', text: `[ERROR] ${message}` }],
    structuredContent,
    isError: true,
  }
}
