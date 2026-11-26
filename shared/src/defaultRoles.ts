import { SYSTEM_PERMISSIONS_CATALOG } from './enums';
import type { AssignableFieldPersonaType, RoleSurface } from './enums';

/**
 * Single source of truth for the roles every new tenant starts with.
 * Used by the database seed and by tenant provisioning (`createTenantWithDefaults`).
 */
export interface DefaultRoleDefinition {
  name: string;
  code: string;
  description: string;
  surface: RoleSurface;
  fieldPersonaType: AssignableFieldPersonaType;
  assuranceWeight: number;
  permissionKeys: string[];
}

const FIELD_BASE_PERMISSIONS = ['scope:view', 'visits:view', 'visits:submit'];

const ROLE_DEFINITIONS: DefaultRoleDefinition[] = [
  {
    name: 'Tenant Super Admin',
    code: 'TENANT_SUPER_ADMIN',
    description:
      'Full tenant governance authority: creates custom roles, assigns permissions, configures branding, and oversees all projects.',
    surface: 'WEB',
    fieldPersonaType: 'NONE',
    assuranceWeight: 1.0,
    permissionKeys: SYSTEM_PERMISSIONS_CATALOG.map((p) => p.key),
  },
  {
    name: 'Independent Monitor',
    code: 'MONITOR',
    description:
      'Monitoring and evaluation lead: sets up projects, plans and reviews monitoring visits, follows findings and drives completion.',
    surface: 'WEB',
    fieldPersonaType: 'NONE',
    assuranceWeight: 1.0,
    permissionKeys: [
      'projects:view_assigned',
      'projects:view_all_tenant',
      'projects:view_portfolio',
      'projects:create',
      'projects:activate',
      'projects:edit_baseline',
      'projects:manage_standards_docs',
      'facilities:manage', // R2a
      'forms:manage', // R3
      'scope:view',
      'scope:edit',
      'contractors:manage',
      'sprints:view_status',
      'users:revoke_device',
      'visits:view',
      'visits:review',
      'incidents:view',
      'payments:view',
      'audit:view_ledger',
      'handover:record_response',
      'handover:review_feedback',
      'defects:manage',
      // Phase 14
      'visits:submit',
      'visits:view',
      'findings:manage',
      // Redesign R4
      'visits:view',
      'visits:plan',
      'sprints:verify',
      // Phase 13
      'documents:view',
      'documents:upload',
      'milestones:manage',
      'kickoff:manage',
      'contracts:raise_default',
      // Phase 15
      'completion:draft_certificate',
      'closure:manage_checklist',
      'closure:export_pack',
      'contractors:rate_performance',
      'lessons:manage',
      'lessons:view',
      'kpis:view', // Phase 16
    ],
  },
  {
    name: 'Funder / Finance Officer',
    code: 'LENDER',
    description:
      'Funding organisation or finance officer: records payments made outside the platform and tracks retention.',
    surface: 'WEB',
    fieldPersonaType: 'NONE',
    assuranceWeight: 1.0,
    permissionKeys: [
      'projects:view_assigned',
      'projects:view_all_tenant',
      'projects:view_portfolio',
      'scope:view',
      'sprints:view_status',
      'visits:view',
      'payments:view',
      'payments:record',
      'audit:view_ledger',
      'handover:review_feedback',
      'visits:view',
      'visits:view', // R4
      // Phase 13
      'documents:view',
      // Phase 15: the funder signs off the closure audit and can export the pack.
      'closure:audit_signoff',
      'closure:export_pack',
      'lessons:view',
      'kpis:view', // Phase 16
    ],
  },
  {
    // Phase 11: staff of a flagship or subsidiary organisation who oversee the projects their part
    // of the organisation owns. Sees the organisation tree, not the whole tenant.
    name: 'Organisation Administrator',
    code: 'ORGANIZATION_ADMIN',
    description:
      'Oversees every project owned by their organisation and the organisations below it in the hierarchy.',
    surface: 'WEB',
    fieldPersonaType: 'NONE',
    assuranceWeight: 1.0,
    permissionKeys: [
      'projects:view_assigned',
      'projects:view_organization_tree',
      'projects:view_portfolio',
      'scope:view',
      'sprints:view_status',
      'visits:view',
      'payments:view',
      'audit:view_ledger',
      'visits:view',
      // Redesign R4
      'visits:view',
      'findings:receive_escalations',
      // Phase 13: the owner's executives decide contractor default cases.
      'documents:view',
      'documents:upload',
      'milestones:manage',
      'milestones:waive',
      'kickoff:manage',
      'contracts:raise_default',
      'contracts:decide_default',
      // Phase 15 (Q5): owner-organisation admins sign the Certificate of Completion.
      'completion:draft_certificate',
      'completion:sign_certificate',
      'completion:revoke_certificate',
      'closure:manage_checklist',
      'closure:export_pack',
      'contractors:rate_performance',
      'lessons:manage',
      'lessons:view',
      'kpis:view', // Phase 16
    ],
  },
  {
    name: 'Monitor Inspector (Visiting QS / COREN)',
    code: 'MONITOR_INSPECTOR',
    description:
      'Visiting Quantity Surveyor or COREN Engineer from the independent monitoring firm: carries out monitoring visits on the field app.',
    surface: 'MOBILE',
    fieldPersonaType: 'INDEPENDENT_VERIFIER',
    assuranceWeight: 1.0,
    // Phase 10: verifiers check and close defect rectification during the liability period.
    permissionKeys: [...FIELD_BASE_PERMISSIONS, 'defects:manage', 'findings:manage'],
  },
  {
    name: 'Independent Resident Clerk of Works',
    code: 'INDEPENDENT_RESIDENT',
    description:
      'Full-time on-site resident supervisor: carries out monitoring visits and keeps the site log on the field app.',
    surface: 'MOBILE',
    fieldPersonaType: 'INDEPENDENT_VERIFIER',
    assuranceWeight: 0.85,
    permissionKeys: [...FIELD_BASE_PERMISSIONS, 'defects:manage', 'findings:manage'],
  },
];

/** Keys are de-duplicated: redesign R7a merged several legacy keys into one. */
export const DEFAULT_TENANT_ROLES: DefaultRoleDefinition[] = ROLE_DEFINITIONS.map((role) => ({
  ...role,
  permissionKeys: [...new Set(role.permissionKeys)],
}));
