function assertObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }
  return value
}

export async function parse(rawInput) {
  const input = assertObject(rawInput ?? {}, 'troll.run input must be an object')
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
    throw new Error('prompt is required')
  }

  return {
    prompt: input.prompt.trim(),
  }
}

export const metadata = {
  summary: 'Generate a curated-history reply comment',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: {
        type: 'string',
        minLength: 1,
        description: 'Prompt/comment input to answer from the curated history context'
      }
    },
    required: ['prompt']
  },
  mcp: {
    examples: [
      { prompt: '平台不是不允许AI号吗' }
    ]
  }
}
