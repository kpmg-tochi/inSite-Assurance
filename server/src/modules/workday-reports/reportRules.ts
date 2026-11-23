import { AiFieldNoteExtraction, AiOmissionPayload, ExtractedQuantityItem } from '@insite/shared';

/**
 * Deterministic report helpers. The platform runs no AI models (client requirement), so these rules
 * are the only engine: they restate what the reporter wrote and flag missing proof. They never link
 * a BOQ item, describe a photo or invent text.
 */

export interface OmissionCheckResult {
  hasUnexplainedOmission: boolean;
  omissionPayload: AiOmissionPayload | null;
  reasoning: string;
}

/** Restates the reporter's words; pulls "40 bags", "12m", "2 trips" style quantities and obvious blockers. */
export function extractFieldNoteByRules(text: string): AiFieldNoteExtraction {
  const extracted: ExtractedQuantityItem[] = [];
  const regex = /(\d+(?:\.\d+)?)\s*(bags?|meters?|m3|m2|m|trips?|tons?|tonnes?|cubics?)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const qty = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    if (!extracted.some((e) => e.quantity === qty && e.unit === unit)) {
      extracted.push({
        materialOrWork: unit.startsWith('bag') ? 'Cement used' : unit.startsWith('trip') ? 'Aggregate / material delivery' : 'Measured site work',
        quantity: qty,
        unit,
        boqWbsCodeHint: null,
      });
    }
  }
  const blockers: string[] = [];
  if (/rain|flood|water/i.test(text)) blockers.push('Weather / rainfall impact reported on site');
  if (/delay|shortage|wait/i.test(text)) blockers.push('Material delivery or logistics delay noted');
  return {
    normalizedSummary: text,
    extractedQuantities: extracted,
    siteBlockers: blockers,
    matchedBoqWbsCodes: [],
    visionObservationSummary: null,
  };
}

/**
 * Flags a report that needed visual proof (hold point, or a checklist line asking for a photo,
 * certificate or test) and has none, unless the report gives a reason.
 */
export function evaluateOmissionsByRules(params: {
  wbsCode: string;
  summaryText: string;
  reportedQuantity: number;
  isHoldPoint: boolean;
  holdPointInstruction?: string | null;
  isHoldPointClaimed: boolean;
  checklist: string[];
  captures: Array<{ mediaType: string }>;
  delaysOrBlockers?: string | null;
}): OmissionCheckResult {
  const photoCount = params.captures.filter(
    (c) => c.mediaType === 'SITE_PHOTO' || c.mediaType === 'MILL_CERTIFICATE' || c.mediaType === 'LAB_CUBE_TEST_CERT'
  ).length;
  const combinedText = `${params.summaryText} ${params.delaysOrBlockers || ''}`.toLowerCase();
  const checklistNeedsProof = params.checklist.some((item) => /photo|certificate|test|slump|rebar|grid/i.test(item));
  const requiresVisualProof =
    (params.isHoldPoint && (params.reportedQuantity > 0 || params.isHoldPointClaimed)) ||
    (checklistNeedsProof && params.reportedQuantity > 0);
  const hasJustification =
    Boolean(params.delaysOrBlockers && params.delaysOrBlockers.trim().length > 5) ||
    /(rain|delay|halted|postponed|pending|cancelled|camera|no pour|omitted|not poured|waiting)/i.test(combinedText);

  if (requiresVisualProof && photoCount === 0 && !hasJustification) {
    const requirement = params.isHoldPoint
      ? params.holdPointInstruction || `Hold-point photo or proof required for WBS ${params.wbsCode}.`
      : params.checklist.find((c) => /photo|certificate|test/i.test(c)) ||
        `Photo or test evidence required by the reporting checklist for WBS ${params.wbsCode}.`;
    const omittedItems = params.isHoldPoint
      ? ['Geotagged hold-point inspection photo', 'Test or mill certificate, or a note saying why it is missing']
      : ['Geotagged site progress photo required by the reporting checklist'];
    return {
      hasUnexplainedOmission: true,
      omissionPayload: {
        omittedItems,
        expectedRequirement: requirement,
        reasonProvidedInReport: false,
        clarificationQuestion: `Required evidence for WBS ${params.wbsCode} is missing and no reason was given: ${requirement} Please attach the missing photo or proof, or say why it could not be captured, then re-submit.`,
      },
      reasoning: `Rules check: photo or hold-point evidence is required but ${photoCount} photo/certificate capture(s) were attached and no reason was given.`,
    };
  }
  return {
    hasUnexplainedOmission: false,
    omissionPayload: null,
    reasoning:
      photoCount > 0
        ? `Rules check: ${photoCount} photo/certificate capture(s) attached.`
        : hasJustification
          ? 'Rules check: no photo attached; the report gives a reason.'
          : 'Rules check: no photo was required by the hold-point or checklist rules.',
  };
}
