import { z } from 'zod';

/**
 * 1. Dynamic RBAC Surface & Field Persona Enums (Multi-Tenant SaaS)
 */
export const RoleSurfaceEnum = z.enum(['WEB', 'MOBILE', 'BOTH']);
export type RoleSurface = z.infer<typeof RoleSurfaceEnum>;

/**
 * Determines how a mobile field role interacts with workflows & AI briefs:
 * - INDEPENDENT_VERIFIER: Independent M&E / Monitor / Clerk of Works (AI brief tells them what to inspect/verify)
 * - CONTRACTOR_EXECUTOR: Contractor / Trade Engineer (AI brief tells them what to execute & submit)
 * - NONE: Web-only governance role
 */
export const FieldPersonaTypeEnum = z.enum([
  'INDEPENDENT_VERIFIER',
  'CONTRACTOR_EXECUTOR',
  'NONE',
]);
export type FieldPersonaType = z.infer<typeof FieldPersonaTypeEnum>;

/**
 * How people in a mobile-capable role get onto a project (Phase 5, decision G):
 * - JOIN_CODE: a per-project, per-role join code creates an anonymous field session.
 * - PROVISIONED_ACCOUNT: the person signs in with a tenant account and sees every assigned project.
 *   Provisioned roles never require identity assurance and never get join codes.
 */
export const RoleOnboardingModeEnum = z.enum(['JOIN_CODE', 'PROVISIONED_ACCOUNT']);
export type RoleOnboardingMode = z.infer<typeof RoleOnboardingModeEnum>;

/** Where a field session came from: a join code, or a provisioned account signing in. */
export const FieldSessionOriginEnum = z.enum(['JOIN_CODE', 'PROVISIONED_ACCOUNT']);
export type FieldSessionOrigin = z.infer<typeof FieldSessionOriginEnum>;

export const OrganizationCategoryEnum = z.enum([
  'ADVISORY_MONITOR',
  'FINANCIER_LENDER',
  'CONTRACTOR',
  'CLIENT_OWNER',
  'GOVERNMENT_MDA',
  'OTHER',
]);
export type OrganizationCategory = z.infer<typeof OrganizationCategoryEnum>;

/** Display label per organisation tag (Phase 6: an organisation can carry several tags). */
export const ORGANIZATION_CATEGORY_META: Record<OrganizationCategory, { label: string }> = {
  ADVISORY_MONITOR: { label: 'Independent monitor' },
  FINANCIER_LENDER: { label: 'Lender / financier' },
  CONTRACTOR: { label: 'Contractor' },
  CLIENT_OWNER: { label: 'Client / owner' },
  GOVERNMENT_MDA: { label: 'Government MDA' },
  OTHER: { label: 'Other' },
};

/**
 * How organisation fields (monitor, lender, contractors, a user's organisation) take input,
 * per tenant (decision E):
 * - FREE_TEXT: type a name; an organisation is created on save if none matches.
 * - DIRECTORY: pick from configured organisations only.
 * - BOTH: pick, or type a new name.
 */
export const OrgInputModeEnum = z.enum(['FREE_TEXT', 'DIRECTORY', 'BOTH']);
export type OrgInputMode = z.infer<typeof OrgInputModeEnum>;

/** Project lifecycle (decision C). A draft is not live anywhere; activation is one-way. */
export const ProjectStatusEnum = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export type ProjectStatus = z.infer<typeof ProjectStatusEnum>;

/**
 * Phase 10: where an ACTIVE project is in its life. Independent of ProjectStatus (DRAFT, ACTIVE,
 * ARCHIVED), which it does not change.
 */
export const ConstructionPhaseEnum = z.enum(['ACTIVE_CONSTRUCTION', 'HANDOVER_IN_PROGRESS', 'RETENTION_PERIOD', 'COMPLETED_CLOSED']);
export type ConstructionPhase = z.infer<typeof ConstructionPhaseEnum>;

/**
 * Contractor model (decision D):
 * - SINGLE_CONTRACTOR: one contractor, one IPC stream.
 * - MAIN_PLUS_SUBS_UNIFIED_IPC: the main contractor submits IPCs covering every package;
 *   subcontractors may field-report only.
 * - MULTI_PRIME_SEPARATE_IPC: each contractor submits IPCs for its own BOQ items.
 */
export const ContractorExecutionModeEnum = z.enum([
  'SINGLE_CONTRACTOR',
  'MAIN_PLUS_SUBS_UNIFIED_IPC',
  'MULTI_PRIME_SEPARATE_IPC',
]);
export type ContractorExecutionMode = z.infer<typeof ContractorExecutionModeEnum>;

export const CONTRACTOR_EXECUTION_MODE_META: Record<
  ContractorExecutionMode,
  { label: string; description: string }
> = {
  SINGLE_CONTRACTOR: {
    label: 'Single contractor',
    description: 'One contractor delivers the whole project and submits every IPC.',
  },
  MAIN_PLUS_SUBS_UNIFIED_IPC: {
    label: 'Main contractor with subcontractors',
    description: 'The main contractor submits one IPC covering all packages; subcontractors report from site only.',
  },
  MULTI_PRIME_SEPARATE_IPC: {
    label: 'Multiple prime contractors',
    description: 'Each contractor owns its BOQ items and submits its own IPCs.',
  },
};

export const PermissionCategoryEnum = z.enum([
  'TENANT_ADMIN',
  'PORTFOLIO_PROJECTS',
  'BOQ_SCHEDULE',
  'MOBILIZATION_ASSURANCE',
  'FIELD_PRESENCE',
  'REPORT_APPROVALS',
  'FINANCIAL_IPC',
  'AUDIT_CLOSEOUT',
]);
export type PermissionCategory = z.infer<typeof PermissionCategoryEnum>;

export const PERMISSION_CATEGORY_META: Record<
  PermissionCategory,
  { label: string; description: string }
> = {
  TENANT_ADMIN: {
    label: 'Tenant, Roles & Branding',
    description: 'Manage client white-label branding, custom roles, user invitations, and workflow templates.',
  },
  PORTFOLIO_PROJECTS: {
    label: 'Portfolio & Project Visibility',
    description: 'Control project creation, baseline editing, cross-tenant visibility, and executive risk views.',
  },
  BOQ_SCHEDULE: {
    label: 'BOQ, Schedule & Contractors',
    description: 'Upload BOQs, configure hold-points, assign trade contractors, and analyze/refactor schedules.',
  },
  MOBILIZATION_ASSURANCE: {
    label: 'Mobilization & Access Assurance',
    description: 'Pre-register site personnel, configure reminders, review ID/liveness, and revoke device sessions.',
  },
  FIELD_PRESENCE: {
    label: 'Field Capture & Site Presence',
    description: 'Join projects on mobile, submit field reports, perform GPS check-ins, and manage no-show alerts.',
  },
  REPORT_APPROVALS: {
    label: 'Report Review & Approvals',
    description: 'Inspect submitted workday/period reports, raise verification queries, and approve completion.',
  },
  FINANCIAL_IPC: {
    label: 'IPC, Milestones & Drawdowns',
    description: 'Submit IPC claims, run AI reconciliation, certify valuations, and approve tranche/milestone releases.',
  },
  AUDIT_CLOSEOUT: {
    label: 'Audit, Handover & Retention',
    description: 'Inspect cryptographic audit logs, issue stakeholder handover links, and manage retention defects.',
  },
};

export interface SystemPermissionCatalogItem {
  key: string;
  name: string;
  description: string;
  category: PermissionCategory;
  surface: RoleSurface;
  unlocksViews: string[];
}

export const SYSTEM_PERMISSIONS_CATALOG: SystemPermissionCatalogItem[] = [
  // 1. TENANT_ADMIN
  {
    key: 'tenant:manage_branding',
    name: 'Manage Tenant White-Label Branding',
    description: 'Customize organization logo, primary palette, and PDF valuation report headers.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Tenant Branding'],
  },
  {
    key: 'roles:create_edit',
    name: 'Create & Customize Roles & Permissions',
    description: 'Create custom client roles, rename role labels, and assign categorized permissions.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Roles & Permissions'],
  },
  {
    key: 'users:invite_manage',
    name: 'Manage Users & Project Assignments',
    description: 'Create tenant users, assign custom roles, and scope user visibility to specific projects.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Users & Visibility'],
  },
  {
    key: 'tenant:manage_settings',
    name: 'Manage Tenant Settings',
    description: 'Change tenant-wide settings such as currency, timezone and security policy.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Tenant Settings'],
  },
  {
    key: 'organizations:manage',
    name: 'Manage Organisation Directory',
    description: 'Add, edit, tag and archive the organisations offered in project and user forms.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Organisations'],
  },
  {
    key: 'templates:manage_workflows',
    name: 'Configure Project Workflow Templates',
    description: 'Define reusable client workflow templates, required steps, and approval chains.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Workflow Templates'],
  },
  // Phase 11: delivery models
  {
    key: 'project_types:manage',
    name: 'Manage Project Types',
    description: 'Define delivery models (project types): their workflow template, ownership and party rules, and defaults.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Project Types'],
  },
  {
    key: 'regions:manage',
    name: 'Manage Regions',
    description: 'Add, rename and archive the regions and areas projects can be placed in.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Regions'],
  },

  // 2. PORTFOLIO_PROJECTS
  {
    key: 'projects:view_assigned',
    name: 'View Assigned Projects',
    description: 'View dashboard, map, and baseline details for projects explicitly assigned to the user.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['All Projects (Assigned)', 'Project Dashboard'],
  },
  {
    key: 'projects:view_all_tenant',
    name: 'View All Projects Across Tenant',
    description: 'Global visibility across every project belonging to the client tenant.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['All Projects (Tenant-Wide)'],
  },
  {
    key: 'projects:view_organization_tree',
    name: 'View Projects Owned by My Organisation Tree',
    description:
      "See every project owned by the user's organisation or by any organisation below it in the hierarchy (Phase 11).",
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['All Projects (Organisation Tree)'],
  },
  {
    key: 'projects:view_portfolio',
    name: 'View Portfolio Dashboard',
    description: 'Open the portfolio dashboard: a map of every visible project with portfolio KPI cards.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Portfolio Dashboard'],
  },
  {
    key: 'projects:view_executive_matrix',
    name: 'Access Executive Risk Matrix',
    description: 'View cross-facility financial commitments, holdbacks, and risk standing.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Executive Risk Matrix'],
  },
  {
    key: 'projects:create',
    name: 'Create & Initialize New Projects',
    description: 'Create new project baselines, geofences, tranches, and initial BOQ schedules.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['+ New Project Wizard'],
  },
  {
    key: 'projects:activate',
    name: 'Activate Draft Projects',
    description: 'Set a completed draft project live: issues join codes and makes it visible on mobile and in portfolio views.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Project setup -> Set project active'],
  },
  {
    key: 'projects:edit_baseline',
    name: 'Edit Project Baseline, Geofence & Cadence',
    description: 'Update project parameters, geofence boundaries, and reporting cadence rules.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Project Baseline Settings'],
  },
  {
    key: 'projects:manage_standards_docs',
    name: 'Manage Standards & Needs Assessments',
    description: 'Upload needs assessment documents and manage engineering standards specs.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Standards & Needs Docs'],
  },

  // 3. BOQ_SCHEDULE
  {
    key: 'boq:view',
    name: 'View Bill of Quantities (BOQ) & WBS',
    description: 'Read-only access to baseline BOQ items, quantities, and Hold-Point rules.',
    category: 'BOQ_SCHEDULE',
    surface: 'BOTH',
    unlocksViews: ['BOQ & Hold-Points', 'Mobile WBS Inbox'],
  },
  {
    key: 'boq:upload_edit',
    name: 'Upload BOQ & Edit WBS Mappings',
    description: 'Import BOQ spreadsheets and confirm AI-suggested tranche mappings.',
    category: 'BOQ_SCHEDULE',
    surface: 'WEB',
    unlocksViews: ['BOQ Import & Mapping'],
  },
  {
    key: 'boq:configure_hold_points',
    name: 'Configure Mandatory Visual Hold-Points',
    description: 'Flag or unflag critical WBS items as Mandatory Visual Hold-Points.',
    category: 'BOQ_SCHEDULE',
    surface: 'WEB',
    unlocksViews: ['BOQ Hold-Point Controls'],
  },
  {
    key: 'contractors:manage_packages',
    name: 'Manage Contractors & Trade Packages',
    description: 'Create/assign multiple trade contractors and review AI BOQ contractor suggestions.',
    category: 'BOQ_SCHEDULE',
    surface: 'WEB',
    unlocksViews: ['Project Contractors'],
  },
  {
    key: 'schedule:view_variance',
    name: 'View Project Schedule Variance',
    description: 'Monitor planned vs. actual schedule progress (ahead, on time, behind).',
    category: 'BOQ_SCHEDULE',
    surface: 'WEB',
    unlocksViews: ['Schedule Variance Analytics'],
  },
  {
    key: 'schedule:catch_up_refactor',
    name: 'Refactor Schedule ("Catch Project Up")',
    description: 'Re-baseline downstream WBS dates to absorb delays while preserving daily rates.',
    category: 'BOQ_SCHEDULE',
    surface: 'WEB',
    unlocksViews: ['Catch Project Up Wizard'],
  },
  {
    key: 'schedule:approve_refactor',
    name: 'Approve Schedule Refactoring',
    description: 'Approve or reject proposed baseline schedule shifts when approval is required.',
    category: 'BOQ_SCHEDULE',
    surface: 'WEB',
    unlocksViews: ['Schedule Change Approvals'],
  },

  // 4. MOBILIZATION_ASSURANCE
  {
    key: 'mobilization:manage_roster',
    name: 'Manage Expected Mobilization Roster',
    description: 'Pre-register expected contractors/monitors with planned mobilization dates.',
    category: 'MOBILIZATION_ASSURANCE',
    surface: 'WEB',
    unlocksViews: ['Settings -> Access & Mobilization', 'Project Join Codes'],
  },
  {
    key: 'mobilization:configure_reminders',
    name: 'Configure Onboarding Reminders',
    description: 'Set automated countdown reminders before planned site mobilization dates.',
    category: 'MOBILIZATION_ASSURANCE',
    surface: 'WEB',
    unlocksViews: ['Onboarding Reminder Settings'],
  },
  {
    key: 'assurance:review_credentials',
    name: 'Approve/Reject Identity & Credentials',
    description: 'Review mobile ID cards, 3D liveness selfies, and regulatory licenses.',
    category: 'MOBILIZATION_ASSURANCE',
    surface: 'WEB',
    unlocksViews: ['Contractor Verification Queue'],
  },
  {
    key: 'sessions:revoke_device',
    name: 'Revoke or Restore Mobile Device Sessions',
    description: 'Manage active mobile field agent sessions and revoke compromised devices.',
    category: 'MOBILIZATION_ASSURANCE',
    surface: 'WEB',
    unlocksViews: ['Settings -> Active Field Personnel'],
  },

  // 5. FIELD_PRESENCE
  {
    key: 'field:join_project',
    name: 'Join Project via Mobile Join Code',
    description: 'Authenticate a mobile field device onto a project via join code.',
    category: 'FIELD_PRESENCE',
    surface: 'MOBILE',
    unlocksViews: ['Mobile Project Onboarding'],
  },
  {
    key: 'field:submit_report',
    name: 'Capture Field Evidence & Submit Reports',
    description: 'Capture live geotagged photos, voice notes, and submit period/workday reports.',
    category: 'FIELD_PRESENCE',
    surface: 'MOBILE',
    unlocksViews: ['Mobile WBS Chat & Camera'],
  },
  {
    key: 'field:manual_checkin',
    name: 'Perform On-Site GPS Check-In',
    description: 'Submit explicit on-site presence check-ins within project geofence.',
    category: 'FIELD_PRESENCE',
    surface: 'MOBILE',
    unlocksViews: ['Mobile Site Check-In'],
  },
  {
    key: 'field:raise_incident',
    name: 'Submit Special Incident / Whistleblower Alert',
    description: 'Escalate safety emergencies, material failures, or confidential disclosures.',
    category: 'FIELD_PRESENCE',
    surface: 'MOBILE',
    unlocksViews: ['Mobile Incident Escalation'],
  },
  {
    key: 'presence:view_telemetry',
    name: 'View Site Presence & Geotag Telemetry',
    description: 'Inspect hourly GPS telemetry, check-in timestamps, and submission geotags.',
    category: 'FIELD_PRESENCE',
    surface: 'WEB',
    unlocksViews: ['Site Presence Telemetry Panel'],
  },
  {
    key: 'presence:manage_noshow_alerts',
    name: 'Manage No-Show & Late Check-In Alerts',
    description: 'Acknowledge or resolve missed check-in and mobilization no-show alerts.',
    category: 'FIELD_PRESENCE',
    surface: 'WEB',
    unlocksViews: ['Site Attendance Alerts'],
  },

  // 6. REPORT_APPROVALS
  {
    key: 'reports:view_all',
    name: 'View Submitted Field Reports',
    description: 'Inspect submitted workday/period reports, AI assessments, and evidence.',
    category: 'REPORT_APPROVALS',
    surface: 'WEB',
    unlocksViews: ['Daily Reports & Site Telemetry'],
  },
  {
    key: 'reports:raise_query',
    name: 'Raise Verification Queries on Reports/IPCs',
    description: 'Dispatch clarification queries to field WBS chats or IPC line items.',
    category: 'REPORT_APPROVALS',
    surface: 'WEB',
    unlocksViews: ['Raise Query Composer'],
  },
  {
    key: 'reports:respond_query',
    name: 'Respond to Queries & Resubmit Evidence',
    description: 'Reply to monitor queries on IPC claims or mobile WBS threads.',
    category: 'REPORT_APPROVALS',
    surface: 'BOTH',
    unlocksViews: ['IPC Query Reply', 'Mobile Revalidation'],
  },
  {
    key: 'reports:approve_completion',
    name: 'Approve Field Reports as Completed',
    description: 'Sign off submitted field reports when report approval gating is enabled.',
    category: 'REPORT_APPROVALS',
    surface: 'WEB',
    unlocksViews: ['Report Approval Queue'],
  },

  // 7. FINANCIAL_IPC
  {
    key: 'ipc:view',
    name: 'View IPC Claims & Reconciliation Queue',
    description: 'View submitted IPCs, evidence strength ratings, and reconciliation tables.',
    category: 'FINANCIAL_IPC',
    surface: 'WEB',
    unlocksViews: ['IPC Reconciliation Workbench'],
  },
  {
    key: 'ipc:submit_claim',
    name: 'Submit Contractor IPC Drawdown Claims',
    description: 'Create and submit Interim Payment Certificate claims for tranches.',
    category: 'FINANCIAL_IPC',
    surface: 'WEB',
    unlocksViews: ['+ Submit New IPC Claim'],
  },
  {
    key: 'ipc:trigger_ai_reconcile',
    name: 'Run AI Evidence-to-Claim Reconciliation',
    description: 'Trigger or re-run AI cross-examination of claims against field evidence.',
    category: 'FINANCIAL_IPC',
    surface: 'WEB',
    unlocksViews: ['Re-Run Reconciliation', 'Smart Visit Planner'],
  },
  {
    key: 'ipc:certify_valuation',
    name: 'Certify Valuation Report',
    description: 'Formally certify line-item completion % and recommend tranche release/holdback.',
    category: 'FINANCIAL_IPC',
    surface: 'WEB',
    unlocksViews: ['Certify Valuation Modal'],
  },
  {
    key: 'tranche:approve_disbursement',
    name: 'Approve Tranche / Milestone Disbursement',
    description: 'Record formal financier/approver release, holdback, or hold decisions.',
    category: 'FINANCIAL_IPC',
    surface: 'WEB',
    unlocksViews: ['Tranche Disbursement Modal'],
  },
  {
    key: 'milestone:verify_direct_release',
    name: 'Verify Direct Milestone Release (No-IPC Mode)',
    description: 'Verify milestone completion directly from evidence when IPCs are disabled.',
    category: 'FINANCIAL_IPC',
    surface: 'WEB',
    unlocksViews: ['Direct Milestone Release'],
  },
  {
    key: 'valuation:export_pdf',
    name: 'Export Valuation Report PDF',
    description: 'Generate and download branded Disbursement Evidence & Valuation Report PDFs.',
    category: 'FINANCIAL_IPC',
    surface: 'WEB',
    unlocksViews: ['Export Valuation PDF'],
  },

  // 8. AUDIT_CLOSEOUT
  {
    key: 'incidents:view_confidential',
    name: 'View Confidential Whistleblower Identity',
    description: 'See the reporter identity on confidential whistleblower disclosures. Grant sparingly.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Incidents -> Reporter identity'],
  },
  {
    key: 'audit:view_ledger',
    name: 'Inspect Cryptographic Audit Ledger',
    description: 'View immutable SHA-256 hash-chained governance events and resolve incidents.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Audit Ledger'],
  },
  {
    key: 'handover:manage_links',
    name: 'Generate Stakeholder Handover Links',
    description: 'Create tokenized external stakeholder feedback links for project handover.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Project Handover Console'],
  },
  {
    key: 'handover:review_feedback',
    name: 'Review Stakeholder Handover Feedback',
    description: 'Inspect stakeholder sign-offs, uploaded handover reports, and recordings.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Handover Feedback Viewer'],
  },
  {
    key: 'retention:manage_defects',
    name: 'Manage Retention Period Defect Tickets',
    description: 'Log, assign, and verify maintenance/defect tickets during the retention period.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'BOTH',
    unlocksViews: ['Retention & Defects Console'],
  },
  {
    key: 'retention:release_escrow',
    name: 'Approve Final Retention Release',
    description: 'Release held-back retention funds once retention period & defects clear.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Retention Release Gate'],
  },
];

/**
 * 1b. Nigerian & Configurable Professional Regulatory License Types
 */
export const ProfessionalLicenseTypeEnum = z.enum([
  'QSRBN',  // Quantity Surveyors Registration Board of Nigeria
  'COREN',  // Council for the Regulation of Engineering in Nigeria
  'ARCON',  // Architects Registration Council of Nigeria
  'CORBON', // Council of Registered Builders of Nigeria
  'ICAN',   // Institute of Chartered Accountants of Nigeria
  'OTHER',  // Other accredited professional body
]);
export type ProfessionalLicenseType = z.infer<typeof ProfessionalLicenseTypeEnum>;

export const PROFESSIONAL_LICENSE_META: Record<
  ProfessionalLicenseType,
  { code: ProfessionalLicenseType; fullName: string; displayPrefix: string; exampleNumber: string }
> = {
  QSRBN: {
    code: 'QSRBN',
    fullName: 'Quantity Surveyors Registration Board of Nigeria',
    displayPrefix: 'QSRBN Reg. No.',
    exampleNumber: '3842',
  },
  COREN: {
    code: 'COREN',
    fullName: 'Council for the Regulation of Engineering in Nigeria',
    displayPrefix: 'COREN Reg. No.',
    exampleNumber: 'R.49201',
  },
  ARCON: {
    code: 'ARCON',
    fullName: 'Architects Registration Council of Nigeria',
    displayPrefix: 'ARCON Reg. No.',
    exampleNumber: 'F/2914',
  },
  CORBON: {
    code: 'CORBON',
    fullName: 'Council of Registered Builders of Nigeria',
    displayPrefix: 'CORBON Reg. No.',
    exampleNumber: 'B.1840',
  },
  ICAN: {
    code: 'ICAN',
    fullName: 'Institute of Chartered Accountants of Nigeria',
    displayPrefix: 'ICAN Membership No.',
    exampleNumber: 'MB/049120',
  },
  OTHER: {
    code: 'OTHER',
    fullName: 'Other Accredited Regulatory Body',
    displayPrefix: 'License No.',
    exampleNumber: 'REG-1001',
  },
};

/**
 * 2b. Field Assurance Verification Statuses
 */
export const ContractorAssuranceStatusEnum = z.enum([
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
]);
export type ContractorAssuranceStatus = z.infer<typeof ContractorAssuranceStatusEnum>;

/**
 * 3. Geofence Modes
 */
export const GeofenceModeEnum = z.enum([
  'RADIAL',
  'LINEAR_CORRIDOR',
  'PERIMETER',
]);
export type GeofenceMode = z.infer<typeof GeofenceModeEnum>;

export const GEOFENCE_MODE_META: Record<
  GeofenceMode,
  { label: string; shortLabel: string; description: string }
> = {
  RADIAL: {
    label: 'Radial',
    shortLabel: 'Radial',
    description: 'A centre point and radius. Suits buildings, plants and compact sites.',
  },
  LINEAR_CORRIDOR: {
    label: 'Linear corridor',
    shortLabel: 'Corridor',
    description: 'A centreline with a half-width, measured by chainage. Suits roads, pipelines and lines.',
  },
  PERIMETER: {
    label: 'Perimeter',
    shortLabel: 'Perimeter',
    description: 'A drawn boundary polygon. Suits irregular sites such as estates, campuses and farms.',
  },
};

/** Display label for a geofence mode; tolerates unknown values from older data. */
export function geofenceModeLabel(mode: string | null | undefined): string {
  if (!mode) return 'No geofence';
  return (GEOFENCE_MODE_META as Record<string, { label: string }>)[mode]?.label ?? mode;
}

/**
 * Server evaluation of a position against the project geofence (Phase 6). WITHIN_TOLERANCE is
 * outside the boundary but inside the project's tolerance band and counts as valid evidence.
 */
export const GeofenceStatusEnum = z.enum(['INSIDE', 'WITHIN_TOLERANCE', 'OUTSIDE']);
export type GeofenceStatus = z.infer<typeof GeofenceStatusEnum>;

/**
 * 4. Configurable Field Reporting Cadences
 */
export const ReportingCadenceEnum = z.enum([
  'DAILY',
  'WEEKLY',
  'BI_WEEKLY',
  'INSPECTION_ONLY',
  // Phase 8
  'MONTHLY',
  'CUSTOM_INTERVAL',
]);
export type ReportingCadence = z.infer<typeof ReportingCadenceEnum>;

/**
 * 5. AI Evidence Strength Ratings
 */
export const EvidenceStrengthRatingEnum = z.enum([
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'UNSUPPORTED',
  'CONTRADICTED',
]);
export type EvidenceStrengthRating = z.infer<typeof EvidenceStrengthRatingEnum>;

export type EvidenceRatingColorToken = 'emerald' | 'amber' | 'slate' | 'rose';

/**
 * The only source of default labels, descriptions and colours for evidence ratings (decision B).
 * Tenants may override `label` and `description` (see `resolveRatingLabels`); the colour and the
 * canonical meaning are fixed.
 */
export const EVIDENCE_RATING_META: Record<
  EvidenceStrengthRating,
  { label: string; colorToken: EvidenceRatingColorToken; description: string }
> = {
  SUPPORTED: {
    label: 'Supported',
    colorToken: 'emerald',
    description: 'Corroborated by geofence-verified field evidence, fulfilled hold points, and independent logs.',
  },
  PARTIALLY_SUPPORTED: {
    label: 'Partially Supported',
    colorToken: 'amber',
    description: 'Partial quantity alignment or relies exclusively on contractor self-reported evidence.',
  },
  UNSUPPORTED: {
    label: 'Unsupported',
    colorToken: 'slate',
    description: 'Insufficient field logs, missing mandatory Hold-Point pre-pour photos, or unverified quantities.',
  },
  CONTRADICTED: {
    label: 'Contradicted',
    colorToken: 'rose',
    description: 'Direct conflict between IPC claim and site evidence, failed capture integrity, or out-of-corridor proof.',
  },
};

/**
 * 6. Portfolio Geospatial Health Pins
 */
export const PortfolioHealthEnum = z.enum([
  'EVIDENCE_SUPPORTED',
  'EVIDENCE_PARTIAL',
  'EVIDENCE_CONFLICT',
]);
export type PortfolioHealth = z.infer<typeof PortfolioHealthEnum>;

/**
 * 7. Field Evidence Log Lifecycle States
 */
/** Server state of one registered capture (photo, voice note or document). */
export const EvidenceLogStatusEnum = z.enum([
  'REGISTERED',
  'FLAGGED_INTEGRITY',
]);
export type EvidenceLogStatus = z.infer<typeof EvidenceLogStatusEnum>;

/**
 * 8. Media Attachment Types
 */
export const MediaTypeEnum = z.enum([
  'SITE_PHOTO',
  'VOICE_NOTE',
  'WAYBILL_DOCUMENT',
  'LAB_CUBE_TEST_CERT',
  'MILL_CERTIFICATE',
  'BOQ_SPREADSHEET',
  'VALUATION_REPORT_PDF',
  'IDENTITY_DOCUMENT',
  'IDENTITY_SELFIE',
  // Phase 7: needs-assessment documents and standards reference files.
  'PROJECT_DOCUMENT',
]);
export type MediaType = z.infer<typeof MediaTypeEnum>;

/**
 * 9. IPC Claim & Facility Tranche Governance Statuses
 */
export const IpcClaimStatusEnum = z.enum([
  'SUBMITTED',
  'AI_RECONCILED',
  'QUERIED_BY_MONITOR',
  'MONITOR_CERTIFIED',
  'LENDER_DECIDED',
  'REJECTED_WITHDRAWN',
]);
export type IpcClaimStatus = z.infer<typeof IpcClaimStatusEnum>;

export const MonitorRecommendationEnum = z.enum([
  'SUPPORT_FULL_RELEASE',
  'SUPPORT_WITH_HOLDBACK',
  'HOLD',
]);
export type MonitorRecommendation = z.infer<typeof MonitorRecommendationEnum>;

export const LenderDecisionTypeEnum = z.enum([
  'APPROVE_FULL',
  'APPROVE_WITH_HOLDBACK',
  'HOLD',
]);
export type LenderDecisionType = z.infer<typeof LenderDecisionTypeEnum>;

export const ConditionPrecedentStatusEnum = z.enum([
  'PENDING',
  'SATISFIED',
  'WAIVED',
  'BREACHED',
]);
export type ConditionPrecedentStatus = z.infer<typeof ConditionPrecedentStatusEnum>;

export const QueryStatusEnum = z.enum([
  'OPEN',
  'RESPONDED',
  'RESOLVED',
]);
export type QueryStatus = z.infer<typeof QueryStatusEnum>;

/**
 * 10. Immutable Audit Ledger Enums
 */
export const AuditActorTypeEnum = z.enum([
  'WEB_USER',
  'FIELD_AGENT',
  'AI_SYSTEM',
  // Phase 8: scheduled jobs (missed reports, attendance alerts)
  'SYSTEM',
]);
export type AuditActorType = z.infer<typeof AuditActorTypeEnum>;

export const AuditActionTypeEnum = z.enum([
  'TENANT_CREATED',
  'TENANT_BRANDING_UPDATED',
  'ROLE_CREATED',
  'ROLE_UPDATED',
  'ROLE_DELETED',
  'USER_PROJECT_ASSIGNED',
  'PROJECT_CREATED',
  'BASELINE_UPDATED',
  'BOQ_UPLOADED',
  'JOIN_CODE_ISSUED',
  'FIELD_AGENT_JOINED',
  'FIELD_SESSION_STATUS_UPDATED',
  'CONTRACTOR_ASSURANCE_SUBMITTED',
  'CONTRACTOR_ASSURANCE_APPROVED',
  'CONTRACTOR_ASSURANCE_REJECTED',
  'EVIDENCE_EXTRACTED',
  'EVIDENCE_CONFIRMED',
  'EVIDENCE_FLAGGED_INTEGRITY',
  'IPC_SUBMITTED',
  'AI_RECONCILIATION_COMPLETED',
  'MONITOR_QUERY_RAISED',
  'CONTRACTOR_QUERY_RESPONDED',
  'VALUATION_REPORT_CERTIFIED',
  'LENDER_TRANCHE_DECIDED',
  'INCIDENT_REPORT_SUBMITTED',
  'INCIDENT_STATUS_UPDATED',
  'PUSH_TOKEN_REGISTERED',
  'WORKDAY_REPORT_SUBMITTED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DEACTIVATED',
  'JOIN_CODE_ROTATED',
  'LOGIN_FAILED_LOCKOUT',
  'CP_STATUS_CHANGED',
  'CP_WAIVED',
  'MONITOR_QUERY_RESOLVED',
  'IPC_WITHDRAWN',
  'TRANCHE_DECISION_REVERSED',
  'TENANT_SETTINGS_UPDATED',
  'CAPTURE_REGISTERED',
  'CAPTURE_FLAGGED_INTEGRITY',
  'TELEMETRY_ANOMALY_SUMMARY',
  'WORKDAY_REPORTS_RELEASED',
  'DEVICE_KEY_REGISTERED',
  'REPORT_QUERY_RESOLVED',
  'MOBILE_USER_SIGNED_IN',
  'MOBILE_DEVICE_REVOKED',
  'ROLE_ONBOARDING_MODE_CHANGED',
  'ORGANIZATION_CREATED',
  'ORGANIZATION_UPDATED',
  'PROJECT_DRAFT_CREATED',
  'PROJECT_SETUP_STEP_SAVED',
  'PROJECT_ACTIVATED',
  'PROJECT_ARCHIVED',
  'PROJECT_CONTRACTOR_ADDED',
  'PROJECT_CONTRACTOR_REMOVED',
  'BOQ_REVISED',
  'PROJECT_DRAFT_DELETED',
  // Phase 7: process engine, standards, approvals
  'WORKFLOW_TEMPLATE_SAVED',
  'PROJECT_PROCESS_CONFIG_UPDATED',
  'PROJECT_STANDARD_CREATED',
  'PROJECT_STANDARD_UPDATED',
  'PROJECT_STANDARD_DELETED',
  'NEEDS_ASSESSMENT_UPLOADED',
  'NEEDS_ASSESSMENT_DELETED',
  'WORKDAY_REPORT_APPROVED',
  'WORKDAY_REPORT_RETURNED',
  'STANDARDS_VIOLATION_FLAGGED',
  'APPROVAL_STEP_ACTIONED',
  'DIRECT_MILESTONE_VERIFIED',
  // Phase 8: cadence, mobilization, attendance
  'REPORT_SUBMITTED_LATE',
  'REPORT_MISSED',
  'PARTICIPANT_PREREGISTERED',
  'PARTICIPANT_REMINDER_SENT',
  'ATTENDANCE_ALERT_RAISED',
  'ATTENDANCE_ALERT_RESOLVED',
  'MANUAL_CHECKIN_RECORDED',
  'REPORTING_OBLIGATION_EXCUSED',
  // Phase 9: schedule baseline and revisions
  'SCHEDULE_BASELINE_SET',
  'SCHEDULE_REVISION_PROPOSED',
  'SCHEDULE_REVISION_APPLIED',
  'SCHEDULE_REVISION_REJECTED',
  'SCHEDULE_REVISION_WITHDRAWN',
  // Phase 10: handover, retention and defects
  'HANDOVER_LINK_CREATED',
  'HANDOVER_LINK_REVOKED',
  'HANDOVER_SUBMITTED',
  'HANDOVER_REVIEWED',
  'PROJECT_PHASE_CHANGED',
  'RETENTION_WITHHELD',
  'DEFECT_TICKET_RAISED',
  'DEFECT_TICKET_UPDATED',
  'DEFECT_TICKET_CLOSED',
  'RETENTION_RELEASED',
  'RETENTION_RELEASE_REQUESTED',
  'RETENTION_RELEASE_CANCELLED',
  // Phase 11: delivery models
  'PROJECT_TYPE_SAVED',
  'PROJECT_TYPE_APPLIED',
  'ORGANIZATION_HIERARCHY_CHANGED',
  'TERMINOLOGY_UPDATED',
]);
export type AuditActionType = z.infer<typeof AuditActionTypeEnum>;

/**
 * 11. Special Incident & Whistleblowing Enums
 */
export const IncidentCategoryEnum = z.enum([
  'WHISTLEBLOWING',
  'SITE_EMERGENCY',
  'CRITICAL_DELAY',
  'MATERIAL_FAILURE',
]);
export type IncidentCategory = z.infer<typeof IncidentCategoryEnum>;

export const IncidentSeverityEnum = z.enum([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
]);
export type IncidentSeverity = z.infer<typeof IncidentSeverityEnum>;

export const IncidentStatusEnum = z.enum([
  'OPEN',
  'UNDER_REVIEW',
  'ACTION_TAKEN',
  'DISMISSED',
]);
export type IncidentStatus = z.infer<typeof IncidentStatusEnum>;

/**
 * 12. Workday Report Status
 */
export const WorkdayReportStatusEnum = z.enum([
  // Reporter's identity assurance is not approved yet; released by the server on approval.
  'STAGED_UNVERIFIED',
  // Accepted. With report approval off (Phase 7) this is final and counts as evidence.
  'CONFIRMED',
  // Phase 7, report approval on: waiting on a step of the project's report approval chain.
  'PENDING_APPROVAL',
  // Phase 7: every step of the report chain approved; counts as evidence.
  'APPROVED_COMPLETED',
  // Phase 7: a reviewer returned it; the reporter answers the query with a revision.
  'RETURNED_FOR_REVISION',
]);
export type WorkdayReportStatus = z.infer<typeof WorkdayReportStatusEnum>;

/** Post-submission omission check. Runs after the response, never in the request path. */
export const WorkdayAiCheckStatusEnum = z.enum([
  'PENDING',
  'RUNNING',
  'DONE',
  'SKIPPED',
  'FAILED',
]);
export type WorkdayAiCheckStatus = z.infer<typeof WorkdayAiCheckStatusEnum>;

/** Media types a field device may register as a capture. */
export const CaptureMediaTypeEnum = z.enum([
  'SITE_PHOTO',
  'VOICE_NOTE',
  'WAYBILL_DOCUMENT',
  'LAB_CUBE_TEST_CERT',
  'MILL_CERTIFICATE',
]);
export type CaptureMediaType = z.infer<typeof CaptureMediaTypeEnum>;

export const TranscriptionStatusEnum = z.enum(['NOT_APPLICABLE', 'PENDING', 'DONE', 'FAILED']);
export type TranscriptionStatus = z.infer<typeof TranscriptionStatusEnum>;

/**
 * 13. Process engine (Phase 7)
 */

/** Whether a document set must be provided while the project is a draft. */
export const NeedsAssessmentModeEnum = z.enum(['REQUIRED_AT_CREATION', 'OPTIONAL_AT_CREATION', 'DISABLED']);
export type NeedsAssessmentMode = z.infer<typeof NeedsAssessmentModeEnum>;

export const StandardsSpecificationModeEnum = z.enum(['REQUIRED_AT_CREATION', 'OPTIONAL_AT_CREATION', 'DISABLED']);
export type StandardsSpecificationMode = z.infer<typeof StandardsSpecificationModeEnum>;

export const DOCUMENT_MODE_META: Record<NeedsAssessmentMode, { label: string }> = {
  REQUIRED_AT_CREATION: { label: 'Required before activation' },
  OPTIONAL_AT_CREATION: { label: 'Optional' },
  DISABLED: { label: 'Off' },
};

/**
 * How money is released on a project:
 * - IPC_CLAIM_REQUIRED: the contractor submits an IPC; the monitor certifies it (Phase 3).
 * - MILESTONE_DIRECT_DISBURSEMENT: no contractor claim; a licensed verifier certifies progress
 *   directly against field evidence and the system builds the claim.
 */
export const DisbursementMechanismEnum = z.enum(['IPC_CLAIM_REQUIRED', 'MILESTONE_DIRECT_DISBURSEMENT']);
export type DisbursementMechanism = z.infer<typeof DisbursementMechanismEnum>;

export const DISBURSEMENT_MECHANISM_META: Record<DisbursementMechanism, { label: string; description: string }> = {
  IPC_CLAIM_REQUIRED: {
    label: 'Contractor IPC claims',
    description: 'The contractor submits an IPC; the monitor certifies it against evidence before release.',
  },
  MILESTONE_DIRECT_DISBURSEMENT: {
    label: 'Direct milestone release',
    description: 'No contractor claim. A licensed verifier certifies progress from field evidence, then release.',
  },
};

export const StandardCategoryEnum = z.enum([
  'MATERIAL_QUALITY',
  'EXECUTION_METHOD',
  'TESTING_TOLERANCE',
  'SAFETY_ENVIRONMENT',
  'GENERAL_SPECIFICATION',
]);
export type StandardCategory = z.infer<typeof StandardCategoryEnum>;

export const STANDARD_CATEGORY_META: Record<StandardCategory, { label: string }> = {
  MATERIAL_QUALITY: { label: 'Material quality' },
  EXECUTION_METHOD: { label: 'Execution method' },
  TESTING_TOLERANCE: { label: 'Testing and tolerance' },
  SAFETY_ENVIRONMENT: { label: 'Safety and environment' },
  GENERAL_SPECIFICATION: { label: 'General specification' },
};

export const NeedsAssessmentDocTypeEnum = z.enum([
  'COMMUNITY_NEEDS_ASSESSMENT',
  'FEASIBILITY_STUDY',
  'ENVIRONMENTAL_SOCIAL_IMPACT',
  'STAKEHOLDER_REQUIREMENTS',
  'TECHNICAL_BASELINE',
]);
export type NeedsAssessmentDocType = z.infer<typeof NeedsAssessmentDocTypeEnum>;

export const NEEDS_ASSESSMENT_DOC_TYPE_META: Record<NeedsAssessmentDocType, { label: string }> = {
  COMMUNITY_NEEDS_ASSESSMENT: { label: 'Community needs assessment' },
  FEASIBILITY_STUDY: { label: 'Feasibility study' },
  ENVIRONMENTAL_SOCIAL_IMPACT: { label: 'Environmental and social impact' },
  STAKEHOLDER_REQUIREMENTS: { label: 'Stakeholder requirements' },
  TECHNICAL_BASELINE: { label: 'Technical baseline' },
};

export const ApprovalChainTypeEnum = z.enum(['REPORT', 'DISBURSEMENT']);
export type ApprovalChainType = z.infer<typeof ApprovalChainTypeEnum>;

export const ApprovalSubjectTypeEnum = z.enum(['WORKDAY_REPORT', 'VALUATION_REPORT']);
export type ApprovalSubjectType = z.infer<typeof ApprovalSubjectTypeEnum>;

/**
 * Phase 11: which organisation an approval step's actor must belong to, relative to the project.
 * ANY keeps the Phase 7 behaviour (permission and optional role only).
 */
export const ApprovalOrganizationScopeEnum = z.enum(['ANY', 'PROJECT_OWNER', 'PROJECT_OWNER_OR_ANCESTOR', 'FUNDER']);
export type ApprovalOrganizationScope = z.infer<typeof ApprovalOrganizationScopeEnum>;

export const APPROVAL_ORGANIZATION_SCOPE_META: Record<ApprovalOrganizationScope, { label: string; description: string }> = {
  ANY: { label: 'Any organisation', description: 'Anyone with the permission (and role, if named) may act.' },
  PROJECT_OWNER: {
    label: 'Owning organisation',
    description: "Only people in the project's owning organisation may act.",
  },
  PROJECT_OWNER_OR_ANCESTOR: {
    label: 'Owning organisation or above',
    description: "People in the owning organisation or any organisation above it (e.g. the flagship) may act.",
  },
  FUNDER: { label: 'Funding organisation', description: "Only people in the project's funding organisation may act." },
};

/** Phase 11: who a project benefits (the handover recipient defaults to the primary one). */
export const BeneficiaryTypeEnum = z.enum(['SCHOOL', 'COMMUNITY', 'INSTITUTION', 'OTHER']);
export type BeneficiaryType = z.infer<typeof BeneficiaryTypeEnum>;

export const BENEFICIARY_TYPE_META: Record<BeneficiaryType, { label: string }> = {
  SCHOOL: { label: 'School' },
  COMMUNITY: { label: 'Community' },
  INSTITUTION: { label: 'Institution' },
  OTHER: { label: 'Other' },
};

/** REJECT is stored for history but no endpoint accepts it yet (see Phase 7 section 7). */
export const ApprovalDecisionEnum = z.enum(['APPROVE', 'RETURN', 'REJECT']);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionEnum>;

/** Who a morning brief is written for. */
export const BriefPersonaEnum = z.enum(['CONTRACTOR_EXECUTOR', 'INDEPENDENT_VERIFIER']);
export type BriefPersona = z.infer<typeof BriefPersonaEnum>;

/** How a valuation came about: a contractor IPC, or a verifier's direct milestone verification. */
export const ValuationSourceEnum = z.enum(['IPC_CLAIM', 'MILESTONE_DIRECT', 'RETENTION_RELEASE']);
export type ValuationSource = z.infer<typeof ValuationSourceEnum>;
