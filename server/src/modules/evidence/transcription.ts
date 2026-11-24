import { prisma } from '../../config/prisma';
import { whisperService } from '../../integrations/whisper.service';
import { storageService } from '../../integrations/storage.service';

/**
 * Redesign R4c (register section 3): a voice note is transcribed when its capture is registered,
 * off the request path, so visit answers and site log voice notes get a transcript without any other
 * report. Whisper is the only model the platform calls (decision Z). With no provider the capture
 * stays PENDING; a simulated demo transcript is never stored.
 */

type Scheduler = (task: () => Promise<void>) => void;
let scheduler: Scheduler = (task) => {
  setImmediate(() => {
    task().catch((error) => console.warn('[transcription] failed:', error));
  });
};

/** Test hook: run (or collect) the scheduled transcriptions synchronously. */
export function setTranscriptionScheduler(next: Scheduler | null): void {
  scheduler =
    next ??
    ((task) => {
      setImmediate(() => {
        task().catch((error) => console.warn('[transcription] failed:', error));
      });
    });
}

export async function transcribeCapture(captureId: string): Promise<'DONE' | 'FAILED' | 'PENDING' | 'SKIPPED'> {
  const c = await prisma.fieldEvidenceLog.findUnique({ where: { id: captureId }, include: { mediaAttachments: true } });
  const media = c?.mediaAttachments[0];
  if (!c || !media || media.mediaType !== 'VOICE_NOTE' || c.transcriptionStatus === 'DONE') return 'SKIPPED';
  const bytes = whisperService.isConfigured() ? await storageService.getObjectBuffer(media.objectKey) : null;
  const result = await whisperService.transcribeAudio({ audioBuffer: bytes, mimeType: media.mimeType });
  if (result.engine === 'SIMULATED_DEMO') return 'PENDING';
  const status = result.status === 'UNAVAILABLE' ? 'PENDING' : result.status;
  await prisma.fieldEvidenceLog.update({ where: { id: c.id }, data: { transcriptionStatus: status, transcript: result.transcript, transcriptionEngine: result.engine } });
  return status;
}

export function scheduleCaptureTranscription(captureId: string): void {
  scheduler(async () => {
    await transcribeCapture(captureId);
  });
}
