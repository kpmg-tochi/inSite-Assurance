import type { ConstructionPhase } from '../enums';
import type { ProjectStage, ProjectStageEntry, ProjectStageKey } from '../schemas/projectOverview.schema';

/**
 * Redesign R6c (D-R6.18, D-R6.19): the project stage bar
 * Kick-off → Mobilisation → Construction → Completion → Closure.
 *
 * Pure: the server loads the facts in batches (`projectStage.service.ts`) and the phone reads the
 * result from its baseline pack. Timestamps are ISO strings; the UI formats them.
 */
export interface ProjectStageFacts {
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  constructionPhase: ConstructionPhase;
  /** False for an untyped project with no contract milestones: Kick-off and Mobilisation are NOT_TRACKED. */
  kickoffTracked: boolean;
  activatedAt: string | null;
  kickoffHeldAt: string | null;
  /** The `AUTO_CONTRACTOR_ON_SITE` milestone, when the project has one (not waived). */
  contractorOnSite: { done: boolean; completedAt: string | null } | null;
  constructionPhaseChangedAt: string | null;
  /** Creation time of the live (not revoked) Certificate of Completion, drafted or issued. */
  cocDraftedAt: string | null;
  archivedAt: string | null;
  contractTerminated: boolean;
}

export const PROJECT_STAGE_ORDER: ProjectStageKey[] = ['KICKOFF', 'MOBILISATION', 'CONSTRUCTION', 'COMPLETION', 'CLOSURE'];

export const PROJECT_STAGE_LABELS: Record<ProjectStageKey, string> = {
  KICKOFF: 'Kick-off',
  MOBILISATION: 'Mobilisation',
  CONSTRUCTION: 'Construction',
  COMPLETION: 'Completion',
  CLOSURE: 'Closure',
};

function currentStage(f: ProjectStageFacts): ProjectStageKey {
  if (f.status === 'ARCHIVED' || f.constructionPhase === 'RETENTION_PERIOD' || f.constructionPhase === 'COMPLETED_CLOSED') {
    return 'CLOSURE';
  }
  if (f.constructionPhase === 'HANDOVER_IN_PROGRESS' || f.cocDraftedAt) return 'COMPLETION';
  if (!f.kickoffTracked) return 'CONSTRUCTION';
  if (f.contractorOnSite?.done) return 'CONSTRUCTION';
  if (!f.contractorOnSite && f.kickoffHeldAt) return 'CONSTRUCTION';
  if (f.kickoffHeldAt) return 'MOBILISATION';
  return 'KICKOFF';
}

function closureSubLabel(f: ProjectStageFacts): string {
  if (f.status === 'ARCHIVED') return 'Archived';
  if (f.constructionPhase === 'COMPLETED_CLOSED') return 'Closed';
  if (f.constructionPhase === 'RETENTION_PERIOD') return 'Defects liability period';
  return 'Closed';
}

function enteredAt(key: ProjectStageKey, f: ProjectStageFacts): string | null {
  switch (key) {
    case 'KICKOFF':
      return f.activatedAt;
    case 'MOBILISATION':
      return f.kickoffHeldAt;
    case 'CONSTRUCTION':
      if (f.contractorOnSite) return f.contractorOnSite.completedAt;
      return f.kickoffTracked ? f.kickoffHeldAt : f.activatedAt;
    case 'COMPLETION':
      if (f.constructionPhase === 'HANDOVER_IN_PROGRESS') {
        if (f.cocDraftedAt && f.constructionPhaseChangedAt) {
          return f.cocDraftedAt < f.constructionPhaseChangedAt ? f.cocDraftedAt : f.constructionPhaseChangedAt;
        }
        return f.constructionPhaseChangedAt ?? f.cocDraftedAt;
      }
      return f.cocDraftedAt;
    case 'CLOSURE':
      if (f.constructionPhase === 'RETENTION_PERIOD' || f.constructionPhase === 'COMPLETED_CLOSED') {
        return f.constructionPhaseChangedAt ?? f.archivedAt;
      }
      return f.archivedAt;
  }
}

/** Drafts have no stage (no Overview); callers skip them. */
export function deriveProjectStage(f: ProjectStageFacts): ProjectStage {
  const current = currentStage(f);
  const currentIndex = PROJECT_STAGE_ORDER.indexOf(current);
  const stages: ProjectStageEntry[] = PROJECT_STAGE_ORDER.map((key, index) => {
    const untracked = !f.kickoffTracked && (key === 'KICKOFF' || key === 'MOBILISATION');
    if (untracked) {
      return { key, label: PROJECT_STAGE_LABELS[key], state: 'NOT_TRACKED', enteredAt: null, note: 'Not tracked' };
    }
    if (index < currentIndex) {
      const at = enteredAt(key, f);
      return { key, label: PROJECT_STAGE_LABELS[key], state: 'DONE', enteredAt: at, note: at ? null : 'Done, not recorded' };
    }
    if (index === currentIndex) {
      let note: string | null = key === 'CLOSURE' ? closureSubLabel(f) : null;
      if (f.contractTerminated) note = note ? `${note} · Contract terminated` : 'Contract terminated';
      return { key, label: PROJECT_STAGE_LABELS[key], state: 'CURRENT', enteredAt: enteredAt(key, f), note };
    }
    return { key, label: PROJECT_STAGE_LABELS[key], state: 'UPCOMING', enteredAt: null, note: null };
  });
  return {
    current,
    currentLabel: PROJECT_STAGE_LABELS[current],
    subLabel: current === 'CLOSURE' ? closureSubLabel(f) : null,
    stages,
    flags: { contractTerminated: f.contractTerminated, archived: f.status === 'ARCHIVED' },
  };
}

/** The small chip on lists and the header: "Construction", "Closure · Archived". */
export function projectStageChipLabel(stage: Pick<ProjectStage, 'currentLabel' | 'subLabel'>): string {
  return stage.subLabel ? `${stage.currentLabel} · ${stage.subLabel}` : stage.currentLabel;
}
