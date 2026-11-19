import type { AppliedStandard, BriefPersona, FieldPersonaType, MorningDeliverableBriefDto } from '@insite/shared';
import { personaCopy, type PersonaCopy } from '../utils/personaCopy';

/**
 * Morning brief metadata stored in `chat_messages.brief_json` (migration v3, Phase 7 Step 8).
 * Pure (no React Native imports; tested in Node).
 */

/** What the server said about a morning brief: its reader and the standards it applies. */
export interface BriefMeta {
  targetPersona: BriefPersona;
  appliedStandards: AppliedStandard[];
}

export function briefMetaJson(brief: Pick<MorningDeliverableBriefDto, 'targetPersona' | 'appliedStandards'>): string {
  const meta: BriefMeta = {
    targetPersona: brief.targetPersona,
    appliedStandards: (brief.appliedStandards ?? []).map((a) => ({
      code: a.code,
      title: a.title,
      summaryRule: a.summaryRule,
    })),
  };
  return JSON.stringify(meta);
}

/** Null for briefs cached before v3 (brief_json NULL) or unreadable JSON. */
export function parseBriefMeta(json: string | null | undefined): BriefMeta | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<BriefMeta>;
    if (v.targetPersona !== 'CONTRACTOR_EXECUTOR' && v.targetPersona !== 'INDEPENDENT_VERIFIER') return null;
    return {
      targetPersona: v.targetPersona,
      appliedStandards: Array.isArray(v.appliedStandards) ? v.appliedStandards : [],
    };
  } catch {
    return null;
  }
}

/**
 * Wording for a brief card: the persona the server wrote the brief for; for a brief cached before
 * v3, the current session's persona.
 */
export function briefCardCopy(
  meta: BriefMeta | null | undefined,
  sessionPersona: FieldPersonaType | null | undefined
): PersonaCopy {
  return personaCopy(meta?.targetPersona ?? sessionPersona);
}
