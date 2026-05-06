import { timingSafeEqual } from 'node:crypto'

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

export function extractBearerToken(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null

  const match = headerValue.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export function hasValidBearerToken(
  headerValue: string | null | undefined,
  expectedToken: string,
): boolean {
  const token = extractBearerToken(headerValue)
  if (!token) return false
  return secureEquals(token, expectedToken)
}
