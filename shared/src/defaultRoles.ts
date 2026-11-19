import { SYSTEM_PERMISSIONS_CATALOG } from './enums';
import type { FieldPersonaType, RoleSurface } from './enums';

/**
 * Single source of truth for the roles every new tenant starts with.
 * Used by the database seed and by tenant provisioning (`createTenantWithDefaults`).
 */
export interface DefaultRoleDefinition {
  name: string;
  code: string;
  codeSuffix: string | null;
  description: string;
  surface: RoleSurface;
  fieldPersonaType: FieldPersonaType;
  assuranceWeight: number;
  requiresIdentityAssurance: boolean;
  permissionKeys: string[];
}

/**
 * D-3.1: permissions that must be held explicitly. The Tenant Super Admin default role does not
 * receive them, and the platform super admin bypass does not apply to them.
 */
export const SEGREGATED_DISBURSEMENT_PERMISSIONS: string[] = [
  'ipc:certify_valuation',
  'tranche:approve_disbursement',
  // Phase 7: direct milestone verification is a certification, so it is segregated the same way.
  'milestone:verify_direct_release',
];

const FIELD_BASE_PERMISSIONS = [
  'boq:view',
  'field:join_project',
  'field:submit_report',
  'field:manual_checkin',
  'field:raise_incident',
];

export const DEFAULT_TENANT_ROLES: DefaultRoleDefinition[] = [
  {
    name: 'Tenant Super Admin',
    code: 'TENANT_SUPER_ADMIN',
    codeSuffix: null,
    description:
      'Full tenant governance authority: creates custom roles, assigns permissions, configures branding, and oversees all projects.',
    surface: 'WEB',
    fieldPersonaType: 'NONE',
    assuranceWeight: 1.0,
    requiresIdentityAssurance: false,
    // D-3.1 segregation of duties: governance does not include certifying or approving.
    permissionKeys: SYSTEM_PERMISSIONS_CATALOG.map((p) => p.key).filter(
      (key) => !SEGREGATED_DISBURSEMENT_PERMISSIONS.includes(key)
    ),
  },
  {
    name: 'Independent Monitor',
    code: 'MONITOR',
    codeSuffix: null,
    description:
      'Licensed Quantity Surveyor or COREN Engineer certifying physical-to-financial progress and managing site hold-points.',
    surface: 'WEB',
    fieldPersonaType: 'NONE',
    assuranceWeight: 1.0,
    requiresIdentityAssurance: false,
    permissionKeys: [
      'projects:view_assigned',
      'projects:view_all_tenant',
      'projects:view_executive_matrix',
      'projects:create',
      'projects:activate',
      'projects:edit_baseline',
      'projects:manage_standards_docs',
      'boq:view',
      'boq:upload_edit',
      'boq:configure_hold_points',
      'contractors:manage_packages',
      'schedule:view_variance',
      'schedule:catch_up_refactor',
      'mobilization:manage_roster',
      'mobilization:configure_reminders',
      'assurance:review_credentials',
      'sessions:revoke_device',
      'presence:view_telemetry',
      'presence:manage_noshow_alerts',
      'reports:view_all',
      'reports:raise_query',
      'reports:approve_completion',
      'ipc:view',
      'ipc:submit_claim',
      'ipc:trigger_ai_reconcile',
      'ipc:certify_valuation',
      'milestone:verify_direct_release',
      'valuation:export_pdf',
      'audit:view_ledger',
      'handover:manage_links',
      'handover:review_feedback',
      'retention:manage_defects',
    ],
  },
  {
    name: 'Lender / Guarantor',
    code: 'LENDER',
    codeSuffix: null,
    description:
      'Project financier or credit committee officer reviewing certified valuations and approving tranche disbursements.',
    surface: 'WEB',
    fieldPersonaType: 'NONE',
    assuranceWeight: 1.0,
    requiresIdentityAssurance: false,
    permissionKeys: [
      'projects:view_assigned',
      'projects:view_all_tenant',
      'projects:view_executive_matrix',
      'boq:view',
      'schedule:view_variance',
      'schedule:approve_refactor',
      'assurance:review_credentials',
      'presence:view_telemetry',
      'reports:view_all',
      'ipc:view',
      'tranche:approve_disbursement',
      'valuation:export_pdf',
      'audit:view_ledger',
      'handover:review_feedback',
      'retention:release_escrow',
    ],
  },
  {
    name: 'Main Contractor',
    code: 'CONTRACTOR',
    codeSuffix: null,
    description:
      'Contractor portal for submitting IPC claims, responding to monitor queries, and viewing assigned BOQ baselines.',
    surface: 'WEB',
    fieldPersonaType: 'NONE',
    assuranceWeight: 0.4,
    requiresIdentityAssurance: false,
    permissionKeys: [
      'projects:view_assigned',
      'boq:view',
      'mobilization:manage_roster',
      'reports:respond_query',
      'ipc:view',
      'ipc:submit_claim',
      'retention:manage_defects',
    ],
  },
  {
    name: 'Monitor Inspector (Visiting QS / COREN)',
    code: 'MONITOR_INSPECTOR',
    codeSuffix: 'INS',
    description:
      'Visiting Quantity Surveyor or COREN Engineer from the independent monitoring firm (corroboration weight 1.0).',
    surface: 'MOBILE',
    fieldPersonaType: 'INDEPENDENT_VERIFIER',
    assuranceWeight: 1.0,
    requiresIdentityAssurance: false,
    permissionKeys: [...FIELD_BASE_PERMISSIONS],
  },
  {
    name: 'Independent Resident Clerk of Works',
    code: 'INDEPENDENT_RESIDENT',
    codeSuffix: 'COW',
    description:
      'Full-time on-site Resident Clerk of Works or M&E officer overseeing daily quality and compliance (weight 0.85).',
    surface: 'MOBILE',
    fieldPersonaType: 'INDEPENDENT_VERIFIER',
    assuranceWeight: 0.85,
    requiresIdentityAssurance: false,
    permissionKeys: [...FIELD_BASE_PERMISSIONS],
  },
  {
    name: 'Contractor Site Engineer',
    code: 'CONTRACTOR_ENGINEER',
    codeSuffix: 'CON',
    description:
      'Contractor site engineer submitting self-reported progress logs; requires ID and liveness assurance (weight 0.40).',
    surface: 'MOBILE',
    fieldPersonaType: 'CONTRACTOR_EXECUTOR',
    assuranceWeight: 0.4,
    requiresIdentityAssurance: true,
    permissionKeys: [...FIELD_BASE_PERMISSIONS, 'reports:respond_query', 'retention:manage_defects'],
  },
];
