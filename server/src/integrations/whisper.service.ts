import OpenAI, { toFile } from 'openai';
import { env } from '../config/env';

/**
 * Domain-specific prompt glossary to reduce Whisper Word Error Rate (WER) on
 * Nigerian English accents and Nigerian Pidgin construction site reports [S20].
 */
export const NIGERIAN_CONSTRUCTION_WHISPER_PROMPT =
  'Field engineering report in Nigerian English or Nigerian Pidgin on a capital infrastructure site in Nigeria. ' +
  'Vocabulary: chainage, KM, box culvert, blinding, reinforcement, high yield Y16 Y20 steel, BRC mesh, ' +
  'formwork, shuttering, soffit, laterite sub-grade, crushed granite stone base, sharp sand, Dangote cement, ' +
  'Lafarge, BUA, ready-mix Grade C25 C30 concrete, slump test, cube crushing test, waybill, Naira, bags, trips, ' +
  'tons, cubic meters, we dey for site, contractor don cast, rain delay work.';

export interface TranscriptionResult {
  status: 'DONE' | 'FAILED' | 'UNAVAILABLE';
  transcript: string | null;
  engine: 'STANDALONE_WHISPER' | 'SIMULATED_DEMO' | null;
}

class StandaloneWhisperService {
  private client: OpenAI | null = null;

  constructor() {
    if (env.WHISPER_API_KEY) {
      this.client = new OpenAI({
        apiKey: env.WHISPER_API_KEY,
        ...(env.WHISPER_BASE_URL ? { baseURL: env.WHISPER_BASE_URL } : {}),
      });
    }
  }

  public isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Transcribes a voice note from raw bytes (read from the bucket by object key; no URL is fetched).
   *
   * Never invents a transcript: with no provider it returns UNAVAILABLE, on error FAILED, both with
   * no text. A labelled simulated transcript is returned only in DEMO_MODE.
   */
  public async transcribeAudio(params: {
    audioBuffer: Buffer | null;
    fileName?: string;
    mimeType?: string;
  }): Promise<TranscriptionResult> {
    if (!this.client) {
      if (env.DEMO_MODE) {
        return {
          status: 'DONE',
          transcript:
            '[Simulated transcript, demo mode] Team cast 12 meters of culvert wall and used 40 bags of cement.',
          engine: 'SIMULATED_DEMO',
        };
      }
      return { status: 'UNAVAILABLE', transcript: null, engine: null };
    }
    if (!params.audioBuffer) {
      return { status: 'FAILED', transcript: null, engine: 'STANDALONE_WHISPER' };
    }

    try {
      const fileObj = await toFile(
        params.audioBuffer,
        params.fileName || 'field-voice-note.m4a',
        { type: params.mimeType || 'audio/mp4' }
      );
      const transcription = await this.client.audio.transcriptions.create({
        file: fileObj,
        model: env.WHISPER_MODEL || 'whisper-1',
        prompt: NIGERIAN_CONSTRUCTION_WHISPER_PROMPT,
        temperature: 0.1,
      });
      return { status: 'DONE', transcript: transcription.text.trim(), engine: 'STANDALONE_WHISPER' };
    } catch (error) {
      console.warn('[StandaloneWhisperService] Transcription failed:', error);
      return { status: 'FAILED', transcript: null, engine: 'STANDALONE_WHISPER' };
    }
  }
}

export const whisperService = new StandaloneWhisperService();

