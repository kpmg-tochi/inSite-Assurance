import { dispatchQueuedMessages } from '../integrations/messaging';
import { JobContext, registerJob } from './runner';

/**
 * message-dispatch: retries queued outbound messages (Phase 8). The mobilization-reminders and
 * attendance-check jobs that used to live beside it were removed in redesign R1e.
 */
export async function runMessageDispatch({ now }: JobContext): Promise<void> {
  await dispatchQueuedMessages(now);
}

export function registerMessageJobs(): void {
  registerJob({ name: 'message-dispatch', intervalMs: 60 * 1000, run: runMessageDispatch });
}
