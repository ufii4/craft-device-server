import { jsonResponse } from '../responses.ts'

export function handleHealthRequest(): Response {
  return jsonResponse({
    status: 'ok',
    service: 'craft-device-server',
  })
}
