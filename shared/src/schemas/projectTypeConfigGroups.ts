import type { ProjectTypeConfig } from './projectType.schema';

/**
 * Redesign R6e (D-R6.24): the project type editor shows the general fields (name, code, colour,
 * description, default, active) above five tabs, and every `ProjectTypeConfigSchema` key belongs to
 * exactly one tab. A new config key must be added here (the unit test `typeConfigGroups.r6.test.ts`
 * fails otherwise) and given an editor in that tab (CLAUDE.md: "a new config key needs an editor
 * section too").
 */
export const PROJECT_TYPE_CONFIG_GROUP_IDS = ['kickoff', 'monitoring', 'completion', 'kpis', 'advanced'] as const;
export type ProjectTypeConfigGroupId = (typeof PROJECT_TYPE_CONFIG_GROUP_IDS)[number];

export type ProjectTypeConfigKey = keyof ProjectTypeConfig;

export interface ProjectTypeConfigGroupDef {
  id: ProjectTypeConfigGroupId;
  label: string;
  description: string;
  /** Config keys edited in this tab. */
  configKeys: readonly ProjectTypeConfigKey[];
}

export const PROJECT_TYPE_CONFIG_GROUP_DEFS: readonly ProjectTypeConfigGroupDef[] = [
  {
    id: 'kickoff',
    label: 'Kick-off & mobilisation',
    description: 'Contract milestones, the kick-off meeting, required documents and contractor default cases.',
    configKeys: ['contractMilestones', 'kickoff', 'documentRequirements', 'defaultCases'],
  },
  {
    id: 'monitoring',
    label: 'Monitoring',
    description: 'The default monitoring plan and deadlines, the monitoring form per visit kind, and supervision limits.',
    configKeys: ['monitoring', 'visitForms', 'supervision'],
  },
  {
    id: 'completion',
    label: 'Completion & closure',
    description: 'Certificate of Completion signatories and gates, closure checklists, ratings, and retention defaults.',
    configKeys: ['closure', 'payments'],
  },
  {
    id: 'kpis',
    label: 'KPI targets',
    description: 'Programme KPI targets and which KPIs are shown.',
    configKeys: ['kpiTargets'],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    description: 'Workflow template, ownership and party rules, and the funder default.',
    configKeys: ['ownership', 'parties'],
  },
];

/** Every config key → its editor tab. Built from the definitions above. */
export const PROJECT_TYPE_CONFIG_GROUPS = Object.fromEntries(
  PROJECT_TYPE_CONFIG_GROUP_DEFS.flatMap((g) => g.configKeys.map((k) => [k, g.id]))
) as Record<ProjectTypeConfigKey, ProjectTypeConfigGroupId>;

/** The general block above the tabs is not a config group. */
export type ProjectTypeEditorSectionId = 'general' | ProjectTypeConfigGroupId;

/**
 * Where a `SaveProjectTypeRequestSchema` validation issue is shown, from its path: `config.<key>.…`
 * goes to the key's tab (an unknown key to Advanced), `workflowTemplateId` to Advanced, anything
 * else (code, name, description, colour, default, active) to the general block.
 */
export function projectTypeEditorSectionForPath(path: readonly PropertyKey[]): ProjectTypeEditorSectionId {
  const [root, key] = path;
  if (root === 'config') {
    return typeof key === 'string' && key in PROJECT_TYPE_CONFIG_GROUPS
      ? PROJECT_TYPE_CONFIG_GROUPS[key as ProjectTypeConfigKey]
      : 'advanced';
  }
  if (root === 'workflowTemplateId') return 'advanced';
  return 'general';
}
