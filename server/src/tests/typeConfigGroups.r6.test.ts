/**
 * Redesign R6e (D-R6.24): every `ProjectTypeConfigSchema` key belongs to exactly one project type
 * editor tab. Enforces the CLAUDE.md rule "a new config key needs an editor section too": a key
 * added to the schema without a group fails here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_TYPE_CONFIG_GROUP_DEFS,
  PROJECT_TYPE_CONFIG_GROUP_IDS,
  PROJECT_TYPE_CONFIG_GROUPS,
  ProjectTypeConfigSchema,
  projectTypeEditorSectionForPath,
} from '@insite/shared';

const schemaKeys = Object.keys(ProjectTypeConfigSchema.shape).sort();

describe('Redesign R6e: project type config groups', () => {
  it('every config key is in exactly one group', () => {
    const counts = new Map<string, string[]>();
    for (const g of PROJECT_TYPE_CONFIG_GROUP_DEFS) {
      for (const k of g.configKeys) counts.set(k, [...(counts.get(k) ?? []), g.id]);
    }
    const missing = schemaKeys.filter((k) => !counts.has(k));
    assert.deepEqual(missing, [], `config keys without an editor group: ${missing.join(', ')}`);
    const twice = [...counts].filter(([, groups]) => groups.length > 1).map(([k, groups]) => `${k} (${groups.join(', ')})`);
    assert.deepEqual(twice, [], `config keys in more than one group: ${twice.join('; ')}`);
  });

  it('groups name only real config keys, and the map agrees with the definitions', () => {
    const unknown = PROJECT_TYPE_CONFIG_GROUP_DEFS.flatMap((g) => g.configKeys).filter((k) => !schemaKeys.includes(k));
    assert.deepEqual(unknown, [], `groups name keys the schema does not have: ${unknown.join(', ')}`);
    assert.deepEqual(Object.keys(PROJECT_TYPE_CONFIG_GROUPS).sort(), schemaKeys);
    for (const g of PROJECT_TYPE_CONFIG_GROUP_DEFS) {
      for (const k of g.configKeys) assert.equal(PROJECT_TYPE_CONFIG_GROUPS[k], g.id);
    }
  });

  it('defines each group once, in the declared order', () => {
    assert.deepEqual(
      PROJECT_TYPE_CONFIG_GROUP_DEFS.map((g) => g.id),
      [...PROJECT_TYPE_CONFIG_GROUP_IDS]
    );
  });

  it('places the D-R6.24 keys in their tabs', () => {
    assert.equal(PROJECT_TYPE_CONFIG_GROUPS.contractMilestones, 'kickoff');
    assert.equal(PROJECT_TYPE_CONFIG_GROUPS.documentRequirements, 'kickoff');
    assert.equal(PROJECT_TYPE_CONFIG_GROUPS.monitoring, 'monitoring');
    assert.equal(PROJECT_TYPE_CONFIG_GROUPS.visitForms, 'monitoring');
    assert.equal(PROJECT_TYPE_CONFIG_GROUPS.supervision, 'monitoring');
    assert.equal(PROJECT_TYPE_CONFIG_GROUPS.closure, 'completion');
    assert.equal(PROJECT_TYPE_CONFIG_GROUPS.payments, 'completion', 'retention defaults under Completion & closure');
    assert.equal(PROJECT_TYPE_CONFIG_GROUPS.kpiTargets, 'kpis');
    assert.equal(PROJECT_TYPE_CONFIG_GROUPS.ownership, 'advanced');
    assert.equal(PROJECT_TYPE_CONFIG_GROUPS.parties, 'advanced');
  });

  it('maps validation issue paths to the general block or a tab', () => {
    assert.equal(projectTypeEditorSectionForPath(['code']), 'general');
    assert.equal(projectTypeEditorSectionForPath(['name']), 'general');
    assert.equal(projectTypeEditorSectionForPath(['workflowTemplateId']), 'advanced');
    assert.equal(projectTypeEditorSectionForPath(['config', 'contractMilestones', 2, 'label']), 'kickoff');
    assert.equal(projectTypeEditorSectionForPath(['config', 'monitoring', 'visitPlan', 0]), 'monitoring');
    assert.equal(projectTypeEditorSectionForPath(['config', 'payments', 'retentionPercentage']), 'completion');
    assert.equal(projectTypeEditorSectionForPath(['config', 'kpiTargets']), 'kpis');
    assert.equal(projectTypeEditorSectionForPath(['config', 'somethingNew']), 'advanced');
    assert.equal(projectTypeEditorSectionForPath(['config']), 'advanced');
  });
});
