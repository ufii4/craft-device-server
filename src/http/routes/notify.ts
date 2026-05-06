import { hasValidBearerToken } from '../auth.ts'
import {
  errorResponse,
  jsonResponse,
  methodNotAllowedResponse,
  unauthorizedResponse,
} from '../responses.ts'
import type { NotificationService } from '../../notifications/service.ts'

export interface NotifyRouteOptions {
  token: string
  notificationService: NotificationService
}

const NOTIFICATION_TITLE = 'Craft Device Server'
const NOTIFICATION_BODY = 'Hello World'

export async function handleNotifyRequest(
  req: Request,
  options: NotifyRouteOptions,
): Promise<Response> {
  if (req.method !== 'POST') {
    return methodNotAllowedResponse(['POST'])
  }

  if (!hasValidBearerToken(req.headers.get('authorization'), options.token)) {
    return unauthorizedResponse()
  }

  try {
    await options.notificationService.notify({
      title: NOTIFICATION_TITLE,
      body: NOTIFICATION_BODY,
    })

    return jsonResponse({
      ok: true,
      title: NOTIFICATION_TITLE,
      body: NOTIFICATION_BODY,
    })
  } catch (error) {
    return errorResponse(
      500,
      `Failed to send notification: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
