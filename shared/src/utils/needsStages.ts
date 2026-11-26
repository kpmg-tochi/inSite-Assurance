import {
  NEEDS_STAGE_ORDER,
  type NeedsPipelineConfig,
  type NeedsProposalAction,
  type NeedsProposalStatus,
  type NeedsStage,
  type NeedsStageConfig,
  type NeedsTemplateFieldKey,
  type ParsedNeedsAssessment,
} from '../schemas/needsPipeline.schema';

/**
 * Needs pipeline N1: the stage machine, pure (server rules and the web's buttons agree).
 *
 * A proposal has a stage (from its cycle's frozen config) and a status (fixed list, D-N.2):
 * - DRAFT: uploaded in the first stage, not yet submitted.
 * - IN_PROGRESS: waiting for the actor of its stage.
 * - RETURNED: sent back with a reason. The stage does not change: the actor of the stage before it
 *   corrects and resubmits, and the proposal is IN_PROGRESS in the same stage again (plan 6.2).
 * - CONVERTED, NOT_VALIDATED, NOT_SELECTED, WITHDRAWN, MERGED: closed.
 *
 * The server adds what cannot be known here: committee membership and recusals, separation of
 * duties, organisation visibility, open flags and the minimum fields of the current version.
 */

type StagesConfig = Pick<NeedsPipelineConfig, 'stages'>;

/** The stage codes of a pipeline, in its order. */
export function stagesFor(config: StagesConfig): NeedsStage[] {
  return config.stages.map((s) => s.stage);
}

export function stageConfigOf(config: StagesConfig, stage: NeedsStage): NeedsStageConfig | null {
  return config.stages.find((s) => s.stage === stage) ?? null;
}

/** The stage after `stage`; null after the last one (the funding gate converts the proposal). */
export function nextStage(config: StagesConfig, stage: NeedsStage): NeedsStage | null {
  const stages = stagesFor(config);
  const i = stages.indexOf(stage);
  if (i < 0 || i === stages.length - 1) return null;
  return stages[i + 1];
}

/** The stage before `stage`; null for the first one. */
export function previousStage(config: StagesConfig, stage: NeedsStage): NeedsStage | null {
  const stages = stagesFor(config);
  const i = stages.indexOf(stage);
  return i > 0 ? stages[i - 1] : null;
}

export interface NeedsReturnTarget {
  /** The stage whose actor corrects the proposal. */
  correctionStage: NeedsStage;
  /** Who corrects it; null when that stage is run by an approval chain. */
  actorPermissionKey: string | null;
  /** Where the proposal is when it is resubmitted: the stage that returned it. */
  resubmitTo: NeedsStage;
}

/**
 * Who gets a proposal that is returned while in `stage`: the actor of the stage before it. Null for
 * the first stage (nothing to return to) and for a stage the pipeline does not use.
 */
export function returnTarget(config: StagesConfig, stage: NeedsStage): NeedsReturnTarget | null {
  const before = previousStage(config, stage);
  if (!before) return null;
  return { correctionStage: before, actorPermissionKey: stageConfigOf(config, before)?.actorPermissionKey ?? null, resubmitTo: stage };
}

/**
 * The earliest stage a content change reopens once a gate has been passed (plan section 7): a
 * changed scope (sites, facilities, quantities) is validated again; a changed cost is costed again.
 */
export function reopenStageFor(change: 'SCOPE' | 'COST'): NeedsStage {
  return change === 'SCOPE' ? 'VALIDATION' : 'COSTING';
}

/** Permission that uploads and corrects needs assessments when a stage names no actor. */
export const NEEDS_SUBMIT_PERMISSION_KEY = 'needs:submit';

const stageIndex = (stage: NeedsStage) => NEEDS_STAGE_ORDER.indexOf(stage);

/**
 * What a holder of `permissionKeys` may do to a proposal in this stage and status. Bulk actions offer
 * the intersection over the selection (D-N.4).
 */
export function allowedProposalActions(
  proposal: { stage: NeedsStage; status: NeedsProposalStatus },
  config: Pick<NeedsPipelineConfig, 'stages' | 'fundingGate'>,
  permissionKeys: readonly string[]
): NeedsProposalAction[] {
  const has = (key: string | null | undefined) => Boolean(key) && permissionKeys.includes(key as string);
  const { stage, status } = proposal;
  const actor = stageConfigOf(config, stage)?.actorPermissionKey ?? null;
  const out: NeedsProposalAction[] = [];

  if (status === 'NOT_SELECTED') {
    // D-N.19: offered when the next cycle opens.
    if (has('needs:manage_cycle')) out.push('CARRY_FORWARD');
    return out;
  }
  if (status !== 'DRAFT' && status !== 'IN_PROGRESS' && status !== 'RETURNED') return out;
  if (!stageConfigOf(config, stage)) return out;

  if (status === 'RETURNED') {
    const corrector = returnTarget(config, stage)?.actorPermissionKey ?? NEEDS_SUBMIT_PERMISSION_KEY;
    if (has(corrector)) out.push(stage === 'PRIORITISATION' ? 'UPLOAD_COSTED_VERSION' : 'UPLOAD_VERSION', 'RESUBMIT');
    if (has(NEEDS_SUBMIT_PERMISSION_KEY)) out.push('WITHDRAW');
    return out;
  }

  if (status === 'DRAFT' || stage === 'IDENTIFICATION') {
    if (has(actor ?? NEEDS_SUBMIT_PERMISSION_KEY)) out.push('UPLOAD_VERSION', 'SUBMIT');
    if (has(NEEDS_SUBMIT_PERMISSION_KEY)) out.push('WITHDRAW');
    return out;
  }

  // IN_PROGRESS in a later stage.
  switch (stage) {
    case 'VALIDATION':
      if (has(actor)) out.push('RECORD_VALIDATION', 'RETURN');
      break;
    case 'DESIGN':
      if (has(actor)) out.push('UPLOAD_VERSION', 'SUBMIT');
      break;
    case 'COSTING':
      if (has(actor)) out.push('UPLOAD_COSTED_VERSION', 'SIGN_OFF_COSTING', 'RETURN');
      break;
    case 'PRIORITISATION':
      if (has('needs:score')) out.push('SCORE');
      if (has(actor)) out.push('FINALISE_PRIORITISATION', 'RETURN');
      break;
    case 'APPROVAL':
      if (has('needs:submit_portfolio')) out.push('INCLUDE_IN_PORTFOLIO');
      break;
    case 'FUNDING':
      if (config.fundingGate === 'BEAP_APPROVAL') {
        if (has('needs:prepare_beap')) out.push('INCLUDE_IN_BEAP');
      } else if (has(actor ?? 'needs:record_funding')) {
        out.push('RECORD_FUNDING');
      }
      break;
    default:
      break;
  }
  // The submitter may withdraw until the list goes for approval.
  if (stageIndex(stage) < stageIndex('APPROVAL') && has(NEEDS_SUBMIT_PERMISSION_KEY)) out.push('WITHDRAW');
  return out;
}

/** "Budget and appropriation" → "budget and appropriation"; "BEAP" stays "BEAP". */
function lowerFirst(label: string): string {
  const first = label.split(/\s+/)[0] ?? '';
  if (first.length > 1 && first === first.toUpperCase()) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** One label from stage and status: "Draft", "Pending costing", "Returned for correction" … (D-N.2). */
export function proposalStatusLabel(proposal: { stage: NeedsStage; status: NeedsProposalStatus }, config: StagesConfig): string {
  switch (proposal.status) {
    case 'DRAFT':
      return 'Draft';
    case 'IN_PROGRESS': {
      const label = stageConfigOf(config, proposal.stage)?.label ?? proposal.stage.toLowerCase();
      return `Pending ${lowerFirst(label)}`;
    }
    case 'RETURNED':
      return 'Returned for correction';
    case 'CONVERTED':
      return 'Funded, converted to project';
    case 'NOT_VALIDATED':
      return 'Not validated';
    case 'NOT_SELECTED':
      return 'Not funded, carried forward';
    case 'WITHDRAWN':
      return 'Withdrawn';
    case 'MERGED':
      return 'Merged into another proposed project';
    default:
      return proposal.status;
  }
}

/** The template fields a version needs to leave `stage` (empty when the type sets none). */
export function minimumFieldsFor(config: Pick<NeedsPipelineConfig, 'minimumFields'>, stage: NeedsStage): NeedsTemplateFieldKey[] {
  return config.minimumFields[stage] ?? [];
}

/**
 * Which of the required fields a needs assessment lacks. Drawings are proposal documents, so the
 * caller says how many the proposal has.
 */
export function missingMinimumFields(
  parsed: Pick<ParsedNeedsAssessment, 'project' | 'sites' | 'breakdownRows' | 'boqLines' | 'costingSummary'>,
  required: readonly NeedsTemplateFieldKey[],
  facts: { drawingCount: number }
): NeedsTemplateFieldKey[] {
  const proposedRows = parsed.breakdownRows.filter((r) => r.proposedQuantity > 0);
  const present: Record<NeedsTemplateFieldKey, boolean> = {
    NEED: Boolean(parsed.project.title),
    JUSTIFICATION: Boolean(parsed.project.justification),
    SITES: parsed.sites.length > 0,
    BREAKDOWN: proposedRows.length > 0,
    BOQ: parsed.boqLines.length > 0,
    DRAWINGS: facts.drawingCount > 0,
    PRELIMINARY_COST:
      parsed.boqLines.length > 0 ||
      (parsed.costingSummary?.totalNgn ?? 0) > 0 ||
      (proposedRows.length > 0 && proposedRows.every((r) => r.preliminaryCostNgn !== null && r.preliminaryCostNgn > 0)),
  };
  return required.filter((key) => !present[key]);
}
