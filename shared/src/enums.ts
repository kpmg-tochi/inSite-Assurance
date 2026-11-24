import { z } from 'zod';

/**
 * 1. Dynamic RBAC Surface & Field Persona Enums (Multi-Tenant SaaS)
 */
export const RoleSurfaceEnum = z.enum(['WEB', 'MOBILE', 'BOTH']);
export type RoleSurface = z.infer<typeof RoleSurfaceEnum>;

/**
 * How a mobile field role takes part in workflows:
 * - INDEPENDENT_VERIFIER: M&E officer / monitor / clerk of works.
 * - CONTRACTOR_EXECUTOR: legacy. Contractors have no login (redesign R1d, decision P2); no role can be
 *   given this persona (see AssignableFieldPersonaTypeEnum). It stays only for the contractor reporter
 *   scopes in cadence, which the visit plan replaces in R4.
 * - NONE: web-only role.
 */
export const FieldPersonaTypeEnum = z.enum([
  'INDEPENDENT_VERIFIER',
  'CONTRACTOR_EXECUTOR',
  'NONE',
]);
export type FieldPersonaType = z.infer<typeof FieldPersonaTypeEnum>;

/** The personas a role can be given (redesign R1d: no contractor persona). */
export const AssignableFieldPersonaTypeEnum = z.enum(['INDEPENDENT_VERIFIER', 'NONE']);
export type AssignableFieldPersonaType = z.infer<typeof AssignableFieldPersonaTypeEnum>;

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

export const PermissionCategoryEnum = z.enum([
  'TENANT_ADMIN',
  'PORTFOLIO_PROJECTS',
  'BOQ_SCHEDULE',
  'MOBILIZATION_ASSURANCE',
  'FIELD_PRESENCE',
  'REPORT_APPROVALS',
  'PAYMENTS',
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
    description: 'Revoke mobile device sessions.',
  },
  FIELD_PRESENCE: {
    label: 'Field Capture & Site Presence',
    description: 'Submit field reports and captures from the mobile app.',
  },
  REPORT_APPROVALS: {
    label: 'Report Review & Approvals',
    description: 'Inspect submitted workday/period reports, raise verification queries, and approve completion.',
  },
  PAYMENTS: {
    label: 'Payments & Retention',
    description: 'View and record contractor payments made outside the platform, and track retention held and released.',
  },
  AUDIT_CLOSEOUT: {
    label: 'Audit, Handover & Retention',
    description: 'Inspect cryptographic audit logs, record handover responses, and manage retention defects.',
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
    description: 'Set a completed draft project live: makes it visible on mobile and in portfolio views.',
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
    name: 'View Scope & Sprints',
    description: 'Read the project scope: sprints, facility units and BoQ lines (hold-point flags read-only).',
    category: 'BOQ_SCHEDULE',
    surface: 'BOTH',
    unlocksViews: ['Scope & sprints', 'Mobile WBS Inbox'],
  },
  {
    key: 'boq:upload_edit',
    name: 'Edit Scope & Sprints',
    description: 'Edit sprints, facility units and BoQ lines, and import the needs-assessment workbook into a draft.',
    category: 'BOQ_SCHEDULE',
    surface: 'WEB',
    unlocksViews: ['Scope & sprints editing', 'Workbook import'],
  },
  {
    key: 'contractors:manage_packages',
    name: 'Manage the Project Contractor',
    description: 'Add, change or remove the project\'s contractor (one per project).',
    category: 'BOQ_SCHEDULE',
    surface: 'WEB',
    unlocksViews: ['Project Contractors'],
  },
  {
    key: 'schedule:view_variance',
    name: 'View Schedule Status',
    description: 'See the sprint schedule badge and get the notification when a project falls behind.',
    category: 'BOQ_SCHEDULE',
    surface: 'WEB',
    unlocksViews: ['Schedule badge', 'Behind-schedule notifications'],
  },
  {
    key: 'documents:view',
    name: 'View Project Documents',
    description: 'Open the project document register, its versions and sign-offs. Contractors see their own and shared types only.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Documents Tab'],
  },
  {
    key: 'documents:upload',
    name: 'Upload Project Documents',
    description: 'Add documents and new versions to the project register, and archive them.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Documents Tab'],
  },
  {
    key: 'documents:manage_types',
    name: 'Manage Document Types',
    description: 'Configure the tenant document types: sign-off, allowed file types and contractor visibility.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Document Types Settings'],
  },
  // Redesign R2a
  {
    key: 'facilities:manage',
    name: 'Manage Facility Catalogue',
    description: 'Add, rename, re-archetype and retire the facilities that scope lines are tagged with.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Facilities'],
  },
  // Redesign R3
  {
    key: 'forms:manage',
    name: 'Manage Form Library',
    description: 'Build and version the visit form library: fixed sections, facility sub-forms and visit form templates.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Forms & facilities'],
  },
  {
    key: 'milestones:manage',
    name: 'Manage Contract Milestones',
    description: 'Complete contract milestones and move the anchor dates (contract award, kick-off) they are computed from.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Milestones Tab'],
  },
  {
    key: 'milestones:waive',
    name: 'Waive Contract Milestones',
    description: 'Waive a contract milestone with a recorded reason.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Milestones Tab'],
  },
  {
    key: 'kickoff:manage',
    name: 'Manage the Kick-off Meeting',
    description: 'Schedule the kick-off meeting, send the notice, and record attendance, quorum and minutes.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Kick-off Meeting'],
  },
  {
    key: 'contracts:raise_default',
    name: 'Raise and Review Contractor Default Cases',
    description: 'Open a default case against a contractor and act on its review steps.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Default Cases'],
  },
  {
    key: 'contracts:decide_default',
    name: 'Decide Contractor Default Cases',
    description: 'Make the final decision on a default case: cure period, extension, termination or closure.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Default Cases'],
  },

  // 4. MOBILIZATION_ASSURANCE
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
    key: 'field:submit_report',
    name: 'Capture Field Evidence & Submit Reports',
    description: 'Capture live geotagged photos, voice notes, and submit period/workday reports.',
    category: 'FIELD_PRESENCE',
    surface: 'MOBILE',
    unlocksViews: ['Mobile WBS Chat & Camera'],
  },
  {
    key: 'field:raise_incident',
    name: 'Submit Special Incident / Whistleblower Alert',
    description: 'Escalate safety emergencies, material failures, or confidential disclosures.',
    category: 'FIELD_PRESENCE',
    surface: 'MOBILE',
    unlocksViews: ['Mobile Incident Escalation'],
  },

  // 6. REPORT_APPROVALS
  {
    key: 'reports:view_all',
    name: 'View Submitted Field Reports',
    description: 'Inspect submitted workday/period reports, AI assessments, and evidence.',
    category: 'REPORT_APPROVALS',
    surface: 'WEB',
    unlocksViews: ['Daily Reports'],
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
  // Phase 14: site inspections
  {
    key: 'inspections:submit',
    name: 'Submit Site Inspection Reports',
    description: 'Complete a checklist inspection (baseline, routine, mobilisation check, final evaluation) on mobile or web.',
    category: 'REPORT_APPROVALS',
    surface: 'BOTH',
    unlocksViews: ['Mobile Inspection Flow', 'Inspections Tab'],
  },
  {
    key: 'inspections:view',
    name: 'View Site Inspections',
    description: 'See inspection reports, their answers and photos, findings and the supervision workload view.',
    category: 'REPORT_APPROVALS',
    surface: 'WEB',
    unlocksViews: ['Inspections Tab', 'Supervisors View'],
  },
  {
    key: 'inspections:manage_findings',
    name: 'Raise and Close Inspection Findings',
    description: 'Raise findings from failed inspection items, and resolve or dismiss them. Contractors resolve their own.',
    category: 'REPORT_APPROVALS',
    surface: 'BOTH',
    unlocksViews: ['Findings Board', 'Mobile Findings'],
  },

  // 7. PAYMENTS (redesign R1b: payments are made outside the platform and recorded here)
  {
    key: 'payments:view',
    name: 'View Payments & Retention',
    description: 'See the payment record, retention held and released, and payment exceptions.',
    category: 'PAYMENTS',
    surface: 'WEB',
    unlocksViews: ['Payments'],
  },
  {
    key: 'payments:record',
    name: 'Record & Void Payments',
    description: 'Record interim, final and retention-release payments made outside the platform, and void a wrong entry with a reason.',
    category: 'PAYMENTS',
    surface: 'WEB',
    unlocksViews: ['Payments -> Record payment'],
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
    key: 'handover:record_response',
    name: 'Record Handover Responses',
    description: "Record the beneficiary's handover response from the signed paper copy.",
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
  // Phase 15: Certificate of Completion and closure governance
  {
    key: 'completion:draft_certificate',
    name: 'Draft Certificates of Completion',
    description: "Draft the Certificate of Completion (scope and completion date) and record the beneficiary's signed paper copy.",
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Handover -> Completion'],
  },
  {
    key: 'completion:sign_certificate',
    name: 'Sign Certificates of Completion',
    description: 'Sign a Certificate of Completion in a signatory slot the project type opens to this permission.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Handover -> Completion'],
  },
  {
    key: 'completion:revoke_certificate',
    name: 'Revoke Certificates of Completion',
    description: 'Revoke an issued certificate with a reason, before the handover is accepted.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Handover -> Completion'],
  },
  {
    key: 'closure:manage_checklist',
    name: 'Manage the Closure Checklist',
    description: 'Tick manual closure items and waive items with a reason.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Closure Tab'],
  },
  {
    key: 'closure:audit_signoff',
    name: 'Sign Off the Closure Audit',
    description: 'Record the audit sign-off item of the closure checklist.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Closure Tab'],
  },
  {
    key: 'closure:export_pack',
    name: 'Export the Closure Pack',
    description: 'Build the closure pack (index, documents, certificates, valuations, inspections and the verified audit ledger) for audit.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Closure Tab'],
  },
  {
    key: 'contractors:rate_performance',
    name: 'Rate Contractor Performance',
    description: 'Rate each contractor at completion and after closure, and see contractor ratings across projects.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Closure Tab', 'Organisation Ratings'],
  },
  {
    key: 'lessons:manage',
    name: 'Record Lessons Learned',
    description: 'Write, edit and publish lessons learned on a project.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Closure Tab'],
  },
  {
    key: 'lessons:view',
    name: 'Browse Lessons Learned',
    description: 'Browse the tenant library of published lessons learned.',
    category: 'AUDIT_CLOSEOUT',
    surface: 'WEB',
    unlocksViews: ['Lessons Learned Library'],
  },
  // Phase 16: programme KPIs
  {
    key: 'kpis:view',
    name: 'View Programme KPIs',
    description:
      'Open the Programme KPIs page and the KPI card of a project: stage KPIs over the visible projects, with targets per project type.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Programme KPIs'],
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
 * 3. Geofence Modes
 */
/** Redesign: linear corridors (centreline + chainage) were removed; sites are radial or perimeter. */
export const GeofenceModeEnum = z.enum([
  'RADIAL',
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
  // Phase 14: calendar quarters (anchor month configurable)
  'QUARTERLY',
]);
export type ReportingCadence = z.infer<typeof ReportingCadenceEnum>;

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
  'IDENTITY_DOCUMENT',
  'IDENTITY_SELFIE',
  // Phase 7: needs-assessment documents and standards reference files.
  'PROJECT_DOCUMENT',
]);
export type MediaType = z.infer<typeof MediaTypeEnum>;

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
  // Phase 8: scheduled jobs (missed reports)
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
  'FIELD_AGENT_JOINED',
  'FIELD_SESSION_STATUS_UPDATED',
  'EVIDENCE_EXTRACTED',
  'EVIDENCE_CONFIRMED',
  'EVIDENCE_FLAGGED_INTEGRITY',
  // Field-report queries (raised by a monitor, answered by the reporter)
  'MONITOR_QUERY_RAISED',
  'CONTRACTOR_QUERY_RESPONDED',
  'INCIDENT_REPORT_SUBMITTED',
  'INCIDENT_STATUS_UPDATED',
  'PUSH_TOKEN_REGISTERED',
  'WORKDAY_REPORT_SUBMITTED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DEACTIVATED',
  'LOGIN_FAILED_LOCKOUT',
  'TENANT_SETTINGS_UPDATED',
  'CAPTURE_REGISTERED',
  'CAPTURE_FLAGGED_INTEGRITY',
  'WORKDAY_REPORTS_RELEASED',
  'DEVICE_KEY_REGISTERED',
  'REPORT_QUERY_RESOLVED',
  'MOBILE_USER_SIGNED_IN',
  'MOBILE_DEVICE_REVOKED',
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
  // Phase 8: cadence
  'REPORT_SUBMITTED_LATE',
  'REPORT_MISSED',
  'REPORTING_OBLIGATION_EXCUSED',
  // Phase 10: handover, retention and defects
  'HANDOVER_RECORDED',
  'HANDOVER_REVIEWED',
  'PROJECT_PHASE_CHANGED',
  'RETENTION_WITHHELD',
  'DEFECT_TICKET_RAISED',
  'DEFECT_TICKET_UPDATED',
  'DEFECT_TICKET_CLOSED',
  'RETENTION_RELEASED',
  // Phase 11: delivery models
  'PROJECT_TYPE_SAVED',
  'PROJECT_TYPE_APPLIED',
  'ORGANIZATION_HIERARCHY_CHANGED',
  'TERMINOLOGY_UPDATED',
  // Phase 14: streams and inspections
  'INSPECTION_SUBMITTED',
  'INSPECTION_REVIEWED',
  'INSPECTION_FINDING_RAISED',
  'INSPECTION_FINDING_RESOLVED',
  'REPORTING_STREAMS_SAVED',
  'CHECKLIST_TEMPLATE_SAVED',
  // Phase 13: documents, contract milestones, kick-off, default cases
  'DOCUMENT_UPLOADED',
  'DOCUMENT_VERSIONED',
  'DOCUMENT_SIGNED',
  'DOCUMENT_ARCHIVED',
  'DOCUMENT_TYPE_SAVED',
  'CONTRACT_DETAILS_SAVED',
  'MILESTONE_COMPLETED',
  'MILESTONE_WAIVED',
  'MILESTONE_DATES_RECOMPUTED',
  'KICKOFF_SCHEDULED',
  'KICKOFF_NOTICE_SENT',
  'KICKOFF_HELD',
  'DEFAULT_CASE_OPENED',
  'DEFAULT_CASE_REVIEWED',
  'DEFAULT_CASE_DECIDED',
  'CONTRACTOR_TERMINATED',
  // Phase 15
  'COC_DRAFTED',
  'COC_SIGNED',
  'COC_ISSUED',
  'COC_REVOKED',
  'HANDOVER_CERTIFICATE_ISSUED',
  'CLOSURE_ITEM_COMPLETED',
  'CLOSURE_ITEM_WAIVED',
  'CLOSURE_AUDIT_SIGNED',
  'CONTRACTOR_RATED',
  'LESSON_PUBLISHED',
  'CLOSURE_PACK_EXPORTED',
  // Redesign R1b
  'PAYMENT_RECORDED',
  'PAYMENT_VOIDED',
  // Redesign R2
  'FACILITY_SAVED',
  'SCOPE_UPDATED',
  'SPRINTS_SAVED',
  'SCOPE_IMPORTED',
  // Redesign R3
  'FORM_COMPONENT_SAVED',
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

/** Phase 13 adds CONTRACT_DEFAULT (contractor default cases). */
export const ApprovalChainTypeEnum = z.enum(['REPORT', 'CONTRACT_DEFAULT']);
export type ApprovalChainType = z.infer<typeof ApprovalChainTypeEnum>;

export const ApprovalSubjectTypeEnum = z.enum(['WORKDAY_REPORT', 'SITE_INSPECTION', 'CONTRACT_DEFAULT_CASE']);
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


