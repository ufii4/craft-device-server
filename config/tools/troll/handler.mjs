import { appendFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODEL = 'xiaomi/mimo-v2.5'
const TEMPERATURE = 1.3
const PRESENCE_PENALTY = 0.5
const FREQUENCY_PENALTY = 0.2
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const REQUEST_TIMEOUT_MS = 20_000
const MIN_EXEMPLAR_SCORE = 0.34
const TOOL_DIR = dirname(fileURLToPath(import.meta.url))
const CONTEXT_FILE = join(TOOL_DIR, 'context.json')
const ERROR_LOG_FILE = join(TOOL_DIR, 'troll-errors.log')

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'check',
      description: 'Check the current comment content.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reason',
      description: 'Record internal reasoning before replying.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string' },
        },
        required: ['content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'comment',
      description: 'Send a public reply comment.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string' },
        },
        required: ['content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skip',
      description: 'Skip replying to the current comment.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
]

function silentResult() {
  return {
    ok: true,
    hints: {
      httpStatus: 204,
      mcpContent: [],
    },
  }
}

function successResult(comment) {
  return {
    ok: true,
    data: comment,
    hints: {
      httpHeaders: {
        'content-type': 'text/plain; charset=utf-8',
      },
      mcpContent: [{ type: 'text', text: comment }],
      suppressMcpStructuredContent: true,
    },
  }
}

async function logError(error) {
  const message = error instanceof Error ? `${error.stack || error.message}` : String(error)
  await appendFile(ERROR_LOG_FILE, `[${new Date().toISOString()}] ${message}\n`, 'utf8').catch(() => {})
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8').trim()
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value
}

function assistantToolCallMessage(callId, name, input) {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: callId,
        type: 'function',
        function: {
          name,
          arguments: JSON.stringify(input),
        },
      },
    ],
  }
}

function toolResultMessage(callId, content) {
  return {
    role: 'tool',
    tool_call_id: callId,
    content,
  }
}

function buildMessageHistory(parsed, appendedCheckContent) {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Context file is empty.')
  }

  const first = parsed[0]
  if (!first || Array.isArray(first) || first.type !== 'post') {
    throw new Error('The first context entry must be a post object.')
  }

  const messages = [
    {
      role: 'user',
      content: `你正在回复这个笔记的评论区： 「${assertString(first.content, 'post.content')}」`,
    },
  ]

  let callIndex = 0

  for (const block of parsed.slice(1)) {
    if (!Array.isArray(block)) {
      throw new Error('All context entries after the post must be arrays.')
    }

    for (const entry of block) {
      callIndex += 1
      const callId = `${entry.type}_${callIndex}`

      switch (entry.type) {
        case 'comment': {
          messages.push(assistantToolCallMessage(callId, 'check', {}))
          messages.push(toolResultMessage(callId, JSON.stringify({ content: assertString(entry.content, 'comment.content') })))
          break
        }
        case 'think': {
          messages.push(assistantToolCallMessage(callId, 'reason', { content: assertString(entry.content, 'think.content') }))
          messages.push(toolResultMessage(callId, 'ok'))
          break
        }
        case 'respond': {
          messages.push(assistantToolCallMessage(callId, 'comment', { content: assertString(entry.content, 'respond.content') }))
          messages.push(toolResultMessage(callId, entry.rejected ? entry.rejected : 'ok'))
          break
        }
        case 'skip': {
          messages.push(assistantToolCallMessage(callId, 'skip', {}))
          messages.push(toolResultMessage(callId, 'ok'))
          break
        }
        case 'post': {
          throw new Error('Nested post entries are not allowed after the first post.')
        }
        default: {
          throw new Error(`Unsupported entry type: ${entry.type}`)
        }
      }
    }
  }

  const finalCheckId = `check_${callIndex + 1}`
  messages.push(assistantToolCallMessage(finalCheckId, 'check', {}))
  messages.push(toolResultMessage(finalCheckId, JSON.stringify({ content: appendedCheckContent })))

  return messages
}

function parseToolArguments(raw) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeForMatch(value) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

function longestCommonPrefixLength(a, b) {
  const max = Math.min(a.length, b.length)
  let index = 0
  while (index < max && a[index] === b[index]) {
    index += 1
  }
  return index
}

function multisetOverlapScore(a, b) {
  if (!a || !b) return 0

  const counts = new Map()
  for (const char of a) {
    counts.set(char, (counts.get(char) ?? 0) + 1)
  }

  let overlap = 0
  for (const char of b) {
    const remaining = counts.get(char) ?? 0
    if (remaining > 0) {
      overlap += 1
      counts.set(char, remaining - 1)
    }
  }

  return overlap / Math.max(a.length, b.length)
}

function buildBigrams(value) {
  if (!value) return []
  if (value.length === 1) return [value]

  const grams = []
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.push(value.slice(index, index + 2))
  }
  return grams
}

function diceCoefficient(a, b) {
  const left = buildBigrams(a)
  const right = buildBigrams(b)
  if (left.length === 0 || right.length === 0) {
    return 0
  }

  const counts = new Map()
  for (const gram of left) {
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }

  let matches = 0
  for (const gram of right) {
    const remaining = counts.get(gram) ?? 0
    if (remaining > 0) {
      matches += 1
      counts.set(gram, remaining - 1)
    }
  }

  return (2 * matches) / (left.length + right.length)
}

function computeExemplarScore(prompt, candidate) {
  const normalizedPrompt = normalizeForMatch(prompt)
  const normalizedCandidate = normalizeForMatch(candidate)
  if (!normalizedPrompt || !normalizedCandidate) {
    return 0
  }

  if (normalizedPrompt === normalizedCandidate) {
    return 1
  }

  const prefixLength = longestCommonPrefixLength(normalizedPrompt, normalizedCandidate)
  const prefixScore = prefixLength >= 2
    ? Math.min(0.8, prefixLength / Math.max(normalizedPrompt.length, normalizedCandidate.length) + 0.3)
    : 0

  return Math.max(
    prefixScore,
    multisetOverlapScore(normalizedPrompt, normalizedCandidate),
    diceCoefficient(normalizedPrompt, normalizedCandidate),
  )
}

function extractExemplars(parsed) {
  if (!Array.isArray(parsed)) {
    return []
  }

  const exemplars = []
  for (const block of parsed.slice(1)) {
    if (!Array.isArray(block)) {
      continue
    }

    let comment = null
    let respond = null

    for (const entry of block) {
      if (!comment && entry?.type === 'comment' && typeof entry.content === 'string' && entry.content.trim()) {
        comment = entry.content.trim()
      }

      if (!respond && entry?.type === 'respond' && !entry.rejected && typeof entry.content === 'string' && entry.content.trim()) {
        respond = entry.content.trim()
      }

      if (comment && respond) {
        exemplars.push({ comment, respond })
        break
      }
    }
  }

  return exemplars
}

function selectCuratedReply(prompt, parsedContext) {
  const normalizedPrompt = normalizeForMatch(prompt)
  if (!normalizedPrompt) {
    return null
  }

  const exemplars = extractExemplars(parsedContext)
  let best = null

  for (const exemplar of exemplars) {
    const score = computeExemplarScore(prompt, exemplar.comment)
    if (!best || score > best.score) {
      best = { ...exemplar, score }
    }
  }

  return best && best.score >= MIN_EXEMPLAR_SCORE ? best.respond : null
}

async function requestCompletion(messages) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    return null
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: TEMPERATURE,
        presence_penalty: PRESENCE_PENALTY,
        frequency_penalty: FREQUENCY_PENALTY,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`OpenRouter request failed with status ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`OpenRouter request timed out after ${REQUEST_TIMEOUT_MS}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function getAssistantMessage(response) {
  return response?.choices?.[0]?.message ?? null
}

function extractCommentContent(toolCalls) {
  for (const toolCall of toolCalls ?? []) {
    if (toolCall?.type !== 'function' || toolCall.function?.name !== 'comment') {
      continue
    }

    const input = parseToolArguments(toolCall.function.arguments)
    if (typeof input.content === 'string' && input.content.trim()) {
      return input.content.trim()
    }
  }

  return null
}

function buildToolResultContent(toolCall, prompt) {
  if (toolCall?.type !== 'function') {
    return 'ok'
  }

  switch (toolCall.function?.name) {
    case 'check':
      return JSON.stringify({ content: prompt })
    case 'reason':
      return 'ok'
    case 'skip':
      return 'ok'
    case 'comment':
      return 'ok'
    default:
      return 'ok'
  }
}

async function runModel(prompt, parsedContext) {
  const curatedReply = selectCuratedReply(prompt, parsedContext)
  if (curatedReply) {
    return curatedReply
  }

  const messages = buildMessageHistory(parsedContext, prompt)

  try {
    for (let step = 0; step < 3; step += 1) {
      const response = await requestCompletion(messages)
      if (!response) {
        return null
      }

      const message = getAssistantMessage(response)
      const toolCalls = message?.tool_calls ?? []
      if (toolCalls.length === 0) {
        return null
      }

      const comment = extractCommentContent(toolCalls)
      if (comment) {
        return comment
      }

      const shouldSkip = toolCalls.some((toolCall) => toolCall?.type === 'function' && toolCall.function?.name === 'skip')
      if (shouldSkip) {
        return null
      }

      messages.push({
        role: 'assistant',
        content: message?.content ?? null,
        tool_calls: toolCalls,
      })

      for (const toolCall of toolCalls) {
        messages.push(toolResultMessage(toolCall.id, buildToolResultContent(toolCall, prompt)))
      }
    }
  } catch (error) {
    await logError(error)
  }

  return null
}

async function main() {
  try {
    const raw = await readStdin()
    const payload = raw ? JSON.parse(raw) : {}

    if (payload.kind !== 'operation' || payload.tool !== 'troll' || payload.operation !== 'run') {
      process.stdout.write(JSON.stringify(silentResult()))
      return
    }

    const prompt = typeof payload.input?.prompt === 'string' ? payload.input.prompt.trim() : ''
    if (!prompt || !normalizeForMatch(prompt)) {
      process.stdout.write(JSON.stringify(silentResult()))
      return
    }

    const rawContext = await readFile(CONTEXT_FILE, 'utf8')
    const parsedContext = JSON.parse(rawContext)
    const comment = await runModel(prompt, parsedContext)
    process.stdout.write(JSON.stringify(comment ? successResult(comment) : silentResult()))
  } catch (error) {
    await logError(error)
    process.stdout.write(JSON.stringify(silentResult()))
  }
}

await main()
