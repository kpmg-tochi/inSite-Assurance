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
   * Transcribes an audio voice note (from a public/presigned URL or raw Buffer)
   * using the standalone Whisper API endpoint.
   */
  public async transcribeAudio(params: {
    audioUrl?: string;
    audioBuffer?: Buffer;
    fileName?: string;
    mimeType?: string;
    fallbackContextHint?: string;
  }): Promise<{ transcript: string; providerMode: 'STANDALONE_WHISPER' | 'SIMULATED_FALLBACK' }> {
    if (!this.client) {
      const simulated =
        params.fallbackContextHint ||
        'We dey for corridor site today. Team don cast 12 meters of the reinforced drainage culvert wall and use 40 bags of Dangote cement with 2 trips of granite.';
      return {
        transcript: simulated,
        providerMode: 'SIMULATED_FALLBACK',
      };
    }

    try {
      let audioBytes = params.audioBuffer;
      if (!audioBytes && params.audioUrl) {
        const response = await fetch(params.audioUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch audio from ${params.audioUrl}`);
        }
        const arrayBuf = await response.arrayBuffer();
        audioBytes = Buffer.from(arrayBuf);
      }

      if (!audioBytes) {
        throw new Error('No audioBuffer or reachable audioUrl provided for transcription');
      }

      const fileObj = await toFile(
        audioBytes,
        params.fileName || 'field-voice-note.m4a',
        { type: params.mimeType || 'audio/mp4' }
      );

      const transcription = await this.client.audio.transcriptions.create({
        file: fileObj,
        model: env.WHISPER_MODEL || 'whisper-1',
        prompt: NIGERIAN_CONSTRUCTION_WHISPER_PROMPT,
        temperature: 0.1,
      });

      return {
        transcript: transcription.text.trim(),
        providerMode: 'STANDALONE_WHISPER',
      };
    } catch (error) {
      console.warn('[StandaloneWhisperService] Falling back due to error:', error);
      return {
        transcript:
          params.fallbackContextHint ||
          'Voice note captured on site; awaiting manual quantity confirmation.',
        providerMode: 'SIMULATED_FALLBACK',
      };
    }
  }
}

export const whisperService = new StandaloneWhisperService();

