import { z } from 'zod';

export const RegisterPushTokenSchema = z.object({
  deviceToken: z.string().min(10).max(255), // Expo push token or native APNs/FCM token
  devicePlatform: z.enum(['ANDROID', 'IOS', 'WEB']),
  appVersion: z.string().optional(),
  projectId: z.string().uuid().optional(),
});
export type RegisterPushToken = z.infer<typeof RegisterPushTokenSchema>;

export const PushNotificationPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  data: z.record(z.any()).optional(),
});
export type PushNotificationPayload = z.infer<typeof PushNotificationPayloadSchema>;

