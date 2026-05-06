export interface NotificationPayload {
  title: string
  body: string
}

export interface NotificationService {
  notify(payload: NotificationPayload): Promise<void>
}
