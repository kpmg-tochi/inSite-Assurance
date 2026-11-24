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

const FIELD_BASE_PERMISSIONS = [
  'boq:view',
  'field:submit_report',
  'field:raise_incident',
];

export const DEFAULT_TENANT_ROLES: DefaultRoleDefinition[] = [
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
      'Monitoring and evaluation lead: sets up projects, reviews field reports, runs inspections and drives completion.',
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
      'boq:view',
      'boq:upload_edit',
      'contractors:manage_packages',
      'schedule:view_variance',
      'sessions:revoke_device',
      'reports:view_all',
      'reports:raise_query',
      'reports:approve_completion',
      'payments:view',
      'audit:view_ledger',
      'handover:record_response',
      'handover:review_feedback',
      'retention:manage_defects',
      // Phase 14
      'inspections:submit',
      'inspections:view',
      'inspections:manage_findings',
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
      'boq:view',
      'schedule:view_variance',
      'reports:view_all',
      'payments:view',
      'payments:record',
      'audit:view_ledger',
      'handover:review_feedback',
      'inspections:view',
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
      'boq:view',
      'schedule:view_variance',
      'reports:view_all',
      'payments:view',
      'audit:view_ledger',
      'inspections:view',
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
      'Visiting Quantity Surveyor or COREN Engineer from the independent monitoring firm (corroboration weight 1.0).',
    surface: 'MOBILE',
    fieldPersonaType: 'INDEPENDENT_VERIFIER',
    assuranceWeight: 1.0,
    // Phase 10: verifiers check and close defect rectification during the liability period.
    permissionKeys: [...FIELD_BASE_PERMISSIONS, 'retention:manage_defects', 'inspections:submit', 'inspections:manage_findings'],
  },
  {
    name: 'Independent Resident Clerk of Works',
    code: 'INDEPENDENT_RESIDENT',
    description:
      'Full-time on-site Resident Clerk of Works or M&E officer overseeing daily quality and compliance (weight 0.85).',
    surface: 'MOBILE',
    fieldPersonaType: 'INDEPENDENT_VERIFIER',
    assuranceWeight: 0.85,
    permissionKeys: [...FIELD_BASE_PERMISSIONS, 'retention:manage_defects', 'inspections:submit', 'inspections:manage_findings'],
  },
];
