function assertObject(value, message) {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }
  return value
}

function optionalString(value, field) {
  if (value == null) return undefined
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`)
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const SEND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {
      type: 'string',
      description: 'Notification title',
      default: 'Craft Device Server'
    },
    body: {
      type: 'string',
      minLength: 1,
      description: 'Notification body',
      default: 'Hello World'
    }
  }
}

export async function parse(rawInput) {
  const input = assertObject(rawInput, 'notify.send input must be an object when provided')
  return {
    title: optionalString(input.title, 'title') ?? 'Craft Device Server',
    body: optionalString(input.body, 'body') ?? 'Hello World',
  }
}

export const metadata = {
  summary: 'Show a local desktop notification',
  inputSchema: SEND_SCHEMA,
}
