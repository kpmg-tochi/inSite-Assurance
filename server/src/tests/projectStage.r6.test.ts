/**
 * Redesign R6c unit tests: `deriveProjectStage` (plan section 6.1) for every stage, legacy and
 * untyped projects, a CoC drafted during construction, a terminated contractor and archiving.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveProjectStage, projectStageChipLabel, type ProjectStageFacts } from '@insite/shared';

const base: ProjectStageFacts = {
  status: 'ACTIVE',
  constructionPhase: 'ACTIVE_CONSTRUCTION',
  kickoffTracked: true,
  activatedAt: '2026-01-05T09:00:00.000Z',
  kickoffHeldAt: null,
  contractorOnSite: { done: false, completedAt: null },
  constructionPhaseChangedAt: null,
  cocDraftedAt: null,
  archivedAt: null,
  contractTerminated: false,
};

const states = (f: ProjectStageFacts) => deriveProjectStage(f).stages.map((s) => s.state);

describe('deriveProjectStage', () => {
  it('kick-off before the meeting is held', () => {
    const s = deriveProjectStage(base);
    assert.equal(s.current, 'KICKOFF');
    assert.deepEqual(states(base), ['CURRENT', 'UPCOMING', 'UPCOMING', 'UPCOMING', 'UPCOMING']);
    assert.equal(s.stages[0].enteredAt, base.activatedAt);
  });

  it('mobilisation once kick-off is held and the contractor is not on site', () => {
    const f = { ...base, kickoffHeldAt: '2026-01-20T10:00:00.000Z' };
    const s = deriveProjectStage(f);
    assert.equal(s.current, 'MOBILISATION');
    assert.equal(s.stages[0].state, 'DONE');
    assert.equal(s.stages[1].enteredAt, f.kickoffHeldAt);
  });

  it('construction once the contractor-on-site milestone is done', () => {
    const f = { ...base, kickoffHeldAt: '2026-01-20T10:00:00.000Z', contractorOnSite: { done: true, completedAt: '2026-02-10T08:00:00.000Z' } };
    const s = deriveProjectStage(f);
    assert.equal(s.current, 'CONSTRUCTION');
    assert.equal(s.stages[2].enteredAt, '2026-02-10T08:00:00.000Z');
  });

  it('construction when kick-off is held and the type has no contractor-on-site milestone', () => {
    const s = deriveProjectStage({ ...base, kickoffHeldAt: '2026-01-20T10:00:00.000Z', contractorOnSite: null });
    assert.equal(s.current, 'CONSTRUCTION');
  });

  it('legacy/untyped project without milestones: construction, earlier stages not tracked', () => {
    const f = { ...base, kickoffTracked: false, contractorOnSite: null };
    const s = deriveProjectStage(f);
    assert.equal(s.current, 'CONSTRUCTION');
    assert.deepEqual(states(f), ['NOT_TRACKED', 'NOT_TRACKED', 'CURRENT', 'UPCOMING', 'UPCOMING']);
  });

  it('a later fact marks earlier stages done, "not recorded" when the date is missing', () => {
    const f = { ...base, contractorOnSite: { done: true, completedAt: null } };
    const s = deriveProjectStage(f);
    assert.equal(s.current, 'CONSTRUCTION');
    assert.equal(s.stages[1].state, 'DONE');
    assert.equal(s.stages[1].note, 'Done, not recorded');
  });

  it('completion when a CoC is drafted while still in construction', () => {
    const s = deriveProjectStage({ ...base, contractorOnSite: { done: true, completedAt: '2026-02-10T08:00:00.000Z' }, cocDraftedAt: '2026-09-01T08:00:00.000Z' });
    assert.equal(s.current, 'COMPLETION');
    assert.equal(s.stages[3].enteredAt, '2026-09-01T08:00:00.000Z');
  });

  it('completion in handover, entered on the earlier of the phase change and the CoC draft', () => {
    const s = deriveProjectStage({
      ...base,
      constructionPhase: 'HANDOVER_IN_PROGRESS',
      constructionPhaseChangedAt: '2026-09-05T08:00:00.000Z',
      cocDraftedAt: '2026-09-01T08:00:00.000Z',
    });
    assert.equal(s.current, 'COMPLETION');
    assert.equal(s.stages[3].enteredAt, '2026-09-01T08:00:00.000Z');
  });

  it('closure in the defects liability period, closed, and archived', () => {
    const retention = deriveProjectStage({ ...base, constructionPhase: 'RETENTION_PERIOD', constructionPhaseChangedAt: '2026-10-01T08:00:00.000Z' });
    assert.equal(retention.current, 'CLOSURE');
    assert.equal(retention.subLabel, 'Defects liability period');
    assert.equal(retention.stages[4].enteredAt, '2026-10-01T08:00:00.000Z');
    assert.equal(projectStageChipLabel(retention), 'Project closure · Defects liability period');

    const closed = deriveProjectStage({ ...base, constructionPhase: 'COMPLETED_CLOSED' });
    assert.equal(closed.subLabel, 'Closed');

    const archived = deriveProjectStage({ ...base, status: 'ARCHIVED', archivedAt: '2026-11-01T08:00:00.000Z' });
    assert.equal(archived.current, 'CLOSURE');
    assert.equal(archived.subLabel, 'Archived');
    assert.equal(archived.flags.archived, true);
    assert.equal(archived.stages[4].enteredAt, '2026-11-01T08:00:00.000Z');
  });

  it('a terminated contract is noted on the current stage', () => {
    const s = deriveProjectStage({ ...base, kickoffHeldAt: '2026-01-20T10:00:00.000Z', contractTerminated: true });
    assert.equal(s.flags.contractTerminated, true);
    assert.equal(s.stages[1].note, 'Contract terminated');
  });
});
