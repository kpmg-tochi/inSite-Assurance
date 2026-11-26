import { z } from 'zod';

/**
 * 1. Dynamic RBAC Surface & Field Persona Enums (Multi-Tenant SaaS)
 */
export const RoleSurfaceEnum = z.enum(['WEB', 'MOBILE', 'BOTH']);
export type RoleSurface = z.infer<typeof RoleSurfaceEnum>;

/**
 * How a mobile field role takes part in workflows:
 * - INDEPENDENT_VERIFIER: M&E officer / monitor / clerk of works.
 * - NONE: web-only role.
 */
export const FieldPersonaTypeEnum = z.enum([
  'INDEPENDENT_VERIFIER',
  'NONE',
]);
export type FieldPersonaType = z.infer<typeof FieldPersonaTypeEnum>;

/** The personas a role can be given (redesign R1d: no contractor persona; R5f removed the enum value). */
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
  ADVISORY_MONITOR: { label: 'Independent M&E firm' },
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
 * Permission categories follow the programme's flow and the web navigation (redesign R7a). They
 * group the catalogue in the role editor; nothing checks a category.
 */
export const PermissionCategoryEnum = z.enum([
  'TENANT_ADMIN',
  'FORMS_FACILITIES',
  'NEEDS_FUNDING',
  'PORTFOLIO_PROJECTS',
  'SCOPE_SPRINTS',
  'CONTRACT_KICKOFF',
  'VISITS_FINDINGS',
  'PAYMENTS',
  'COMPLETION_CLOSURE',
]);
export type PermissionCategory = z.infer<typeof PermissionCategoryEnum>;

export const PERMISSION_CATEGORY_META: Record<
  PermissionCategory,
  { label: string; description: string }
> = {
  TENANT_ADMIN: {
    label: 'Workspace & access',
    description: 'Workspace settings and branding, users and roles, organisations, zones and states, project types, workflow and document types.',
  },
  FORMS_FACILITIES: {
    label: 'Forms & facilities',
    description: 'The facility catalogue and the monitoring form library.',
  },
  NEEDS_FUNDING: {
    label: 'Needs assessment & funding',
    description:
      'The annual needs assessment cycle: proposed projects, validation, costing, prioritisation, approval, funding and the BEAP; costing and design standards.',
  },
  PORTFOLIO_PROJECTS: {
    label: 'Portfolio & projects',
    description: 'Which projects a user sees, the portfolio and KPIs, and creating, setting up and activating projects.',
  },
  SCOPE_SPRINTS: {
    label: 'BoQ & work phases',
    description: 'Work phases, facility units and BoQ lines, the needs assessment template, the schedule status and work phase verification.',
  },
  CONTRACT_KICKOFF: {
    label: 'Contract & kick-off',
    description: 'The project contractor, contract milestones, the kick-off meeting, default cases and the document register.',
  },
  VISITS_FINDINGS: {
    label: 'Monitoring visits & findings',
    description: 'Planning, carrying out and reviewing monitoring visits; findings, escalations, defects and incidents.',
  },
  PAYMENTS: {
    label: 'Payments & retention',
    description: 'The payment record (payments are made outside the platform), retention held and released, and payment exceptions.',
  },
  COMPLETION_CLOSURE: {
    label: 'Completion & closure',
    description: 'Certificates of Completion, handover, the closure checklist and audit, contractor ratings, lessons learned and the audit ledger.',
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

/**
 * The one permission catalogue. Code owns the permission rows: `syncPermissionCatalog` (server)
 * upserts every entry by key at start-up, in the seed and in tenant provisioning, and never
 * deletes. Renaming or removing a key is migration SQL (redesign R7a), so role grants survive.
 */
export const SYSTEM_PERMISSIONS_CATALOG: SystemPermissionCatalogItem[] = [
  // 1. TENANT_ADMIN: Workspace & access
  {
    key: 'tenant:manage_branding',
    name: 'Manage Workspace Branding',
    description: 'Change the workspace logo, colours and the header shown on generated PDFs.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Branding'],
  },
  {
    key: 'tenant:manage_settings',
    name: 'Manage Workspace Settings',
    description: 'Change workspace settings such as currency, timezone, the default site radius, the monitoring visit reschedule tolerance and the security policy.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Workspace settings'],
  },
  {
    key: 'roles:create_edit',
    name: 'Create & Edit Roles',
    description: 'Create roles, rename them and choose their permissions.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Roles & permissions'],
  },
  {
    key: 'users:invite_manage',
    name: 'Manage Users & Project Assignments',
    description: 'Create users, give them a role and assign them to projects.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Users & visibility'],
  },
  {
    key: 'users:revoke_device',
    name: 'Revoke Field App Devices & Sessions',
    description: 'See the field app accounts signed in on each project, and revoke or restore a device or a session.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Field accounts'],
  },
  {
    key: 'organizations:manage',
    name: 'Manage Organisation Directory',
    description: 'Add, edit, tag and archive the organisations offered in project and user forms, and arrange them in the hierarchy.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Organisations'],
  },
  {
    key: 'regions:manage',
    name: 'Manage Zones & States',
    description: 'Add, rename and archive the zones and states projects can be placed in.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Regions'],
  },
  {
    key: 'project_types:manage',
    name: 'Manage Project Types',
    description: 'Define the project types (delivery models): workflow template, ownership rules, kick-off and milestones, monitoring plan, closure rules and KPI targets.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Project types'],
  },
  {
    key: 'templates:manage_workflows',
    name: 'Configure Workflow Templates',
    description: 'Define reusable workflow templates: process switches and the monitoring report review and default case approval chains.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Workflow templates'],
  },
  {
    key: 'documents:manage_types',
    name: 'Manage Document Types',
    description: 'Configure the document types of the register: sign-off, sign-off permission and allowed file types.',
    category: 'TENANT_ADMIN',
    surface: 'WEB',
    unlocksViews: ['Settings -> Document types'],
  },

  // 2. FORMS_FACILITIES: Forms & facilities
  {
    key: 'facilities:manage',
    name: 'Manage Facility Catalogue',
    description: 'Add, rename, re-archetype and retire the facilities that scope lines are tagged with.',
    category: 'FORMS_FACILITIES',
    surface: 'WEB',
    unlocksViews: ['Forms & facilities -> Facilities'],
  },
  {
    key: 'forms:manage',
    name: 'Manage Form Library',
    description: 'Build and version the monitoring form library: fixed sections, facility sub-forms and monitoring form templates.',
    category: 'FORMS_FACILITIES',
    surface: 'WEB',
    unlocksViews: ['Forms & facilities'],
  },

  // NEEDS_FUNDING: Needs assessment & funding (needs pipeline N1; first in the programme flow)
  {
    key: 'needs:view',
    name: 'View Needs Assessment Cycles',
    description: "See the needs assessment cycles of the user's organisation and those below it: proposed projects, versions, decisions and cycle documents.",
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment'],
  },
  {
    key: 'needs:manage_cycle',
    name: 'Open & Manage Cycles',
    description: 'Open and close an annual cycle, set its deadlines, template and costing standard versions and indicative ceiling, form the steering committee, and carry proposed projects forward.',
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> Cycle'],
  },
  {
    key: 'needs:submit',
    name: 'Upload Needs Assessments',
    description: 'Upload draft needs assessments and corrections as proposed projects, add their documents and submit them for validation.',
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> Upload needs assessments'],
  },
  {
    key: 'needs:validate',
    name: 'Validate Proposed Projects',
    description: 'Record the desk review and site verification of a proposed project, resolve duplicate and essential-facility flags, and validate or return it. Not for a needs assessment the same person uploaded.',
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> Validation'],
  },
  {
    key: 'needs:cost',
    name: 'Cost Proposed Projects',
    description: 'Upload the costed needs assessment, acknowledge rate and ceiling flags, and sign off the cost. Not for a proposed project the same person validated.',
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> Costing'],
  },
  {
    key: 'needs:score',
    name: 'Score Proposed Projects',
    description: "Can be named to a cycle's steering committee: declares conflicts of interest and scores proposed projects against the rubric.",
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> Prioritisation'],
  },
  {
    key: 'needs:chair_committee',
    name: 'Chair the Steering Committee',
    description: 'See every score, set the funding line, override the ranking with a reason and finalise the Prioritised Project Portfolio.',
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> Prioritisation'],
  },
  {
    key: 'needs:submit_portfolio',
    name: 'Submit the Prioritised Portfolio',
    description: 'Submit the Prioritised Project Portfolio for approval.',
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> Approvals'],
  },
  {
    key: 'needs:review_portfolio',
    name: 'Review the Portfolio',
    description: 'Act on the management review step of the portfolio approval.',
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> Approvals'],
  },
  {
    key: 'needs:approve_portfolio',
    name: 'Approve the Portfolio',
    description: 'Approve the portfolio, exclude proposed projects with a reason and attach the signed memo (Executive Secretary; SUBEB Executive Chairman).',
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> Approvals'],
  },
  {
    key: 'needs:record_funding',
    name: 'Record Budget & Appropriation',
    description: 'Record the budget submission and import the appropriated schedule, which turns funded proposed projects into draft projects. Not by the person who approved the portfolio.',
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> Funding'],
  },
  {
    key: 'needs:prepare_beap',
    name: 'Prepare the BEAP',
    description: "Build a State's Basic Education Action Plan (BEAP) from its approved proposed projects (lots, procurement method, counterpart funding), submit it to UBEC and revise it.",
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> BEAP'],
  },
  {
    key: 'needs:review_beap',
    name: 'Review BEAPs',
    description: "Review a State's BEAP for UBEC: accept, comment on or ask to remove each proposed project, and return the BEAP for revision.",
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> BEAP'],
  },
  {
    key: 'needs:approve_beap',
    name: 'Approve BEAPs',
    description: "Approve a State's BEAP for UBEC Executive Management, which turns its proposed projects into draft projects.",
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> BEAP'],
  },
  {
    key: 'needs:approve_out_of_cycle',
    name: 'Approve Out-of-Cycle Projects',
    description: 'Approve a project proposed outside the annual cycle (emergency, directive, supplementary budget) on its authorising document.',
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> Approvals'],
  },
  {
    key: 'needs:override_separation',
    name: 'Authorise Separation of Duties Overrides',
    description: 'Authorise or refuse a request from another person to act on two stages of a proposed project where there is nobody else; never for your own request. The override stays flagged on the proposed project. Grant sparingly.',
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Needs assessment'],
  },
  {
    key: 'standards:manage',
    name: 'Manage Costing & Design Standards',
    description: 'Maintain the costing standards (rates, zone factors, cost ceilings, the supervision and monitoring share) and the design standard documents.',
    category: 'NEEDS_FUNDING',
    surface: 'WEB',
    unlocksViews: ['Standards'],
  },

  // 3. PORTFOLIO_PROJECTS: Portfolio & projects
  {
    key: 'projects:view_assigned',
    name: 'View Assigned Projects',
    description: 'Open the projects the user is assigned to.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Projects (assigned)', 'Project Overview'],
  },
  {
    key: 'projects:view_all_tenant',
    name: 'View Every Project',
    description: 'See every project in the workspace.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Projects (all)'],
  },
  {
    key: 'projects:view_organization_tree',
    name: 'View Projects Owned by My Organisation Tree',
    description: "See every project owned by the user's organisation or by any organisation below it in the hierarchy.",
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Projects (organisation tree)'],
  },
  {
    key: 'projects:view_portfolio',
    name: 'View Portfolio Dashboard',
    description: 'Open the portfolio dashboard: a map of every visible project with portfolio cards.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Portfolio'],
  },
  {
    key: 'kpis:view',
    name: 'View Programme KPIs',
    description:
      'Open the Programme KPIs page and the KPI card of a project: stage KPIs over the visible projects, with targets per project type.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Programme KPIs'],
  },
  {
    key: 'projects:create',
    name: 'Create Projects',
    description: 'Create draft projects and fill in their setup.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['New project'],
  },
  {
    key: 'projects:activate',
    name: 'Activate Draft Projects',
    description: 'Set a completed draft live: monitoring visits are proposed, and the project shows in the field app and the portfolio.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Project setup -> Activate'],
  },
  {
    key: 'projects:edit_baseline',
    name: 'Edit Project Details & Site',
    description: 'Change project details, the site boundary, working days, the team and the monitoring settings.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Project settings'],
  },
  {
    key: 'projects:manage_standards_docs',
    name: 'Manage Standards & Needs Assessments',
    description: 'Upload needs-assessment documents and manage the standards reference documents of a project.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Project setup -> Standards'],
  },
  {
    // Needs pipeline (N1): the procurement plan of the funded drafts.
    key: 'procurement:plan_lots',
    name: 'Plan Procurement Lots',
    description: 'Assign lots and batches to funded draft projects for the procurement plan.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Needs assessment -> Procurement plan'],
  },

  // 4. SCOPE_SPRINTS: Scope & sprints
  {
    key: 'scope:view',
    name: 'View BoQ & Work Phases',
    description: 'Read the project scope: work phases, facility units and BoQ lines.',
    category: 'SCOPE_SPRINTS',
    surface: 'BOTH',
    unlocksViews: ['BoQ & work phases'],
  },
  {
    key: 'scope:edit',
    name: 'Edit BoQ & Work Phases',
    description: 'Edit work phases, facility units and BoQ lines, and import a needs assessment into a draft.',
    category: 'SCOPE_SPRINTS',
    surface: 'WEB',
    unlocksViews: ['BoQ & work phases editing', 'Needs assessment import'],
  },
  {
    key: 'sprints:view_status',
    name: 'View Schedule Status',
    description: 'See the work phase schedule badge and get the notification when a project falls behind.',
    category: 'SCOPE_SPRINTS',
    surface: 'WEB',
    unlocksViews: ['Schedule badge', 'Behind-schedule notifications'],
  },
  {
    key: 'sprints:verify',
    name: 'Verify Work Phases',
    description: 'Record whether an ended work phase was met, partly met or not met.',
    category: 'SCOPE_SPRINTS',
    surface: 'WEB',
    unlocksViews: ['BoQ & work phases verification'],
  },

  // 5. CONTRACT_KICKOFF: Contract & kick-off
  {
    // Client demo updates E3 (wave 3)
    key: 'approved_lists:view',
    name: 'View Approved Project Lists',
    description: 'See the annual approved project lists (Approved Projects & Implementation Schedule, Approved BEAP), their links to projects and budget mismatches.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Needs assessment'],
  },
  {
    // Client demo updates E3 (wave 4)
    key: 'approved_lists:manage',
    name: 'Upload Approved Project Lists',
    description: 'Upload an annual approved project list (Approved Projects & Implementation Schedule or Approved BEAP) from the template; replaces the list of the same year, kind and State.',
    category: 'PORTFOLIO_PROJECTS',
    surface: 'WEB',
    unlocksViews: ['Needs assessment upload'],
  },
  {
    // Client demo updates F.1 (wave 2)
    key: 'contractors:view_register',
    name: 'View the Contractor Register',
    description: 'See every contractor with its status, rating, projects and decisions.',
    category: 'CONTRACT_KICKOFF',
    surface: 'WEB',
    unlocksViews: ['Contractors'],
  },
  {
    key: 'contractors:manage',
    name: 'Manage the Project Contractor',
    description: "Add, change or remove the project's contractor (one per project).",
    category: 'CONTRACT_KICKOFF',
    surface: 'WEB',
    unlocksViews: ['Project setup -> Contractor'],
  },
  {
    key: 'milestones:manage',
    name: 'Manage Contract Milestones',
    description: 'Complete contract milestones and move the anchor dates (contract award, kick-off) they are computed from.',
    category: 'CONTRACT_KICKOFF',
    surface: 'WEB',
    unlocksViews: ['Kick-off & mobilisation -> Milestones'],
  },
  {
    key: 'milestones:waive',
    name: 'Waive Contract Milestones',
    description: 'Waive a contract milestone with a recorded reason.',
    category: 'CONTRACT_KICKOFF',
    surface: 'WEB',
    unlocksViews: ['Kick-off & mobilisation -> Milestones'],
  },
  {
    key: 'kickoff:manage',
    name: 'Manage the Kick-off Meeting',
    description: 'Schedule the kick-off meeting, send the notice, and record attendance, quorum and minutes.',
    category: 'CONTRACT_KICKOFF',
    surface: 'WEB',
    unlocksViews: ['Kick-off & mobilisation -> Kick-off'],
  },
  {
    key: 'contracts:raise_default',
    name: 'Raise and Review Contractor Default Cases',
    description: 'Open a default case against the contractor and act on its review steps.',
    category: 'CONTRACT_KICKOFF',
    surface: 'WEB',
    unlocksViews: ['Default cases'],
  },
  {
    key: 'contracts:decide_default',
    name: 'Decide Contractor Default Cases',
    description: 'Make the final decision on a default case: cure period, extension, termination or closure.',
    category: 'CONTRACT_KICKOFF',
    surface: 'WEB',
    unlocksViews: ['Default cases'],
  },
  {
    key: 'documents:view',
    name: 'View Project Documents',
    description: 'Open the project document register, its versions and sign-offs.',
    category: 'CONTRACT_KICKOFF',
    surface: 'WEB',
    unlocksViews: ['Documents'],
  },
  {
    key: 'documents:upload',
    name: 'Upload Project Documents',
    description: 'Add documents and new versions to the project register, and archive them.',
    category: 'CONTRACT_KICKOFF',
    surface: 'WEB',
    unlocksViews: ['Documents'],
  },

  // 6. VISITS_FINDINGS: Visits & findings
  {
    key: 'visits:view',
    name: 'View Monitoring Visits',
    description: 'See the monitoring plan and planner, monitoring forms, monitoring reports and their evidence, comments, the site log and the supervision workload.',
    category: 'VISITS_FINDINGS',
    surface: 'BOTH',
    unlocksViews: ['Monitoring visits', 'Monitoring planner', 'Settings -> Supervisors'],
  },
  {
    key: 'visits:plan',
    name: 'Plan Monitoring Visits',
    description: 'Create, generate, publish, move, reassign and cancel monitoring visits, and accept or reject date proposals from officers.',
    category: 'VISITS_FINDINGS',
    surface: 'WEB',
    unlocksViews: ['Monitoring planner editing'],
  },
  {
    key: 'visits:submit',
    name: 'Carry Out Monitoring Visits',
    description: 'Respond to assigned monitoring visits (confirm, move, propose, decline), check in, submit monitoring reports and keep the site log from the field app.',
    category: 'VISITS_FINDINGS',
    surface: 'MOBILE',
    unlocksViews: ['Field app -> Monitoring visits'],
  },
  {
    key: 'visits:review',
    name: 'Review Monitoring Reports',
    description: 'Accept or return submitted monitoring reports on the review chain (the default step of the monitoring report review chain).',
    category: 'VISITS_FINDINGS',
    surface: 'WEB',
    unlocksViews: ['Monitoring report review'],
  },
  {
    key: 'findings:manage',
    name: 'Raise and Close Findings',
    description: 'Raise findings on a monitoring report, and resolve or dismiss them.',
    category: 'VISITS_FINDINGS',
    surface: 'WEB',
    unlocksViews: ['Monitoring visits -> Findings'],
  },
  {
    key: 'findings:receive_escalations',
    name: 'Receive Finding Escalations',
    description: 'Be notified when a finding stays open past the escalation period.',
    category: 'VISITS_FINDINGS',
    surface: 'WEB',
    unlocksViews: ['Notifications'],
  },
  {
    key: 'defects:manage',
    name: 'Manage Defects',
    description: 'Raise, assign and verify defects in the defects liability period; officers close them with site photos from the field app.',
    category: 'VISITS_FINDINGS',
    surface: 'BOTH',
    unlocksViews: ['Completion & handover -> Defects', 'Field app -> Defects'],
  },
  {
    key: 'incidents:view',
    name: 'View & Follow Up Incidents',
    description: 'See the incidents raised from the field app on a project and be notified of new ones.',
    category: 'VISITS_FINDINGS',
    surface: 'WEB',
    unlocksViews: ['Incidents'],
  },
  {
    key: 'incidents:view_confidential',
    name: 'View Confidential Reporter Identity',
    description: 'See who reported a confidential incident disclosure. Grant sparingly.',
    category: 'VISITS_FINDINGS',
    surface: 'WEB',
    unlocksViews: ['Incidents -> Reporter identity'],
  },

  // 7. PAYMENTS: Payments & retention
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

  // 8. COMPLETION_CLOSURE: Completion & closure
  {
    key: 'completion:draft_certificate',
    name: 'Draft Certificates of Completion',
    description: "Draft the Certificate of Completion (scope and completion date) and record the beneficiary's signed paper copy.",
    category: 'COMPLETION_CLOSURE',
    surface: 'WEB',
    unlocksViews: ['Completion & handover -> Certificate'],
  },
  {
    key: 'completion:sign_certificate',
    name: 'Sign Certificates of Completion',
    description: 'Sign a Certificate of Completion in a signatory slot the project type opens to this permission.',
    category: 'COMPLETION_CLOSURE',
    surface: 'WEB',
    unlocksViews: ['Completion & handover -> Certificate'],
  },
  {
    key: 'completion:revoke_certificate',
    name: 'Revoke Certificates of Completion',
    description: 'Revoke an issued certificate with a reason, before the handover is accepted.',
    category: 'COMPLETION_CLOSURE',
    surface: 'WEB',
    unlocksViews: ['Completion & handover -> Certificate'],
  },
  {
    key: 'handover:record_response',
    name: 'Record Handover Responses',
    description: "Record the beneficiary's handover response from the signed paper copy.",
    category: 'COMPLETION_CLOSURE',
    surface: 'WEB',
    unlocksViews: ['Completion & handover -> Handover'],
  },
  {
    key: 'handover:review_feedback',
    name: 'Review Handover Responses',
    description: 'Review a recorded handover response; accepting it issues the handover certificate. The person who recorded a response cannot review it.',
    category: 'COMPLETION_CLOSURE',
    surface: 'WEB',
    unlocksViews: ['Completion & handover -> Handover'],
  },
  {
    key: 'closure:manage_checklist',
    name: 'Manage the Closure Checklist',
    description: 'Tick manual closure items and waive items with a reason.',
    category: 'COMPLETION_CLOSURE',
    surface: 'WEB',
    unlocksViews: ['Completion & handover -> Closure'],
  },
  {
    key: 'closure:audit_signoff',
    name: 'Sign Off the Closure Audit',
    description: 'Record the audit sign-off item of the closure checklist.',
    category: 'COMPLETION_CLOSURE',
    surface: 'WEB',
    unlocksViews: ['Completion & handover -> Closure'],
  },
  {
    key: 'closure:export_pack',
    name: 'Export the Project Closure File',
    description: 'Build the project closure file (index, documents, certificates, monitoring report summaries and the verified audit ledger) for audit.',
    category: 'COMPLETION_CLOSURE',
    surface: 'WEB',
    unlocksViews: ['Completion & handover -> Closure'],
  },
  {
    key: 'contractors:rate_performance',
    name: 'Rate Contractor Performance',
    description: 'Rate the contractor at completion and after closure, and see contractor ratings across projects.',
    category: 'COMPLETION_CLOSURE',
    surface: 'WEB',
    unlocksViews: ['Completion & handover -> Closure', 'Organisation ratings'],
  },
  {
    key: 'lessons:manage',
    name: 'Record Lessons Learned',
    description: 'Write, edit and publish lessons learned on a project.',
    category: 'COMPLETION_CLOSURE',
    surface: 'WEB',
    unlocksViews: ['Completion & handover -> Closure'],
  },
  {
    key: 'lessons:view',
    name: 'Browse Lessons Learned',
    description: 'Browse the library of published lessons learned.',
    category: 'COMPLETION_CLOSURE',
    surface: 'WEB',
    unlocksViews: ['Lessons learned'],
  },
  {
    key: 'audit:view_ledger',
    name: 'View the Audit Ledger',
    description: 'View the hash-chained audit ledger and resolve incidents.',
    category: 'COMPLETION_CLOSURE',
    surface: 'WEB',
    unlocksViews: ['Audit ledger', 'Incidents'],
  },
];

/**
 * Redesign R7a: permission keys renamed or removed. Applied to existing databases by migration
 * `20261225090000_r7a_permission_catalogue` (row renamed in place, or grants moved to the new key);
 * kept here for tests and the configuration reference. A `null` target means removed.
 */
export const RENAMED_PERMISSION_KEYS: Readonly<Record<string, string | null>> = {
  'boq:view': 'scope:view',
  'boq:upload_edit': 'scope:edit',
  'schedule:view_variance': 'sprints:view_status',
  'contractors:manage_packages': 'contractors:manage',
  'sessions:revoke_device': 'users:revoke_device',
  'retention:manage_defects': 'defects:manage',
  'inspections:manage_findings': 'findings:manage',
  'reports:approve_completion': 'visits:review',
  'reports:raise_query': 'incidents:view',
  'field:submit_report': 'visits:submit',
  'inspections:submit': 'visits:submit',
  'reports:view_all': 'visits:view',
  'inspections:view': 'visits:view',
  'field:raise_incident': null,
  'reports:respond_query': null,
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
  'INCIDENT_REPORT_SUBMITTED',
  'INCIDENT_STATUS_UPDATED',
  'PUSH_TOKEN_REGISTERED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DEACTIVATED',
  'LOGIN_FAILED_LOCKOUT',
  'TENANT_SETTINGS_UPDATED',
  'CAPTURE_REGISTERED',
  'CAPTURE_FLAGGED_INTEGRITY',
  'DEVICE_KEY_REGISTERED',
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
  'APPROVAL_STEP_ACTIONED',
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
  // Phase 14 (findings; R5f removed the inspection actions)
  'INSPECTION_FINDING_RAISED',
  'INSPECTION_FINDING_RESOLVED',
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
  // UBEC IRL: bulk project register import
  'PROJECT_REGISTER_IMPORTED',
  // Client demo updates C3: project lots
  'PROJECT_LOT_CREATED',
  // Client demo updates (wave 2): sites and the contractor register
  'SITES_SAVED',
  'CONTRACTOR_CREATED',
  'CONTRACTOR_UPDATED',
  'CONTRACTOR_STATUS_CHANGED',
  // Client demo updates (wave 3): contractor flags, approved lists
  'CONTRACTOR_FLAG_RAISED',
  'CONTRACTOR_FLAG_ACTION_DECIDED',
  'CONTRACTOR_FLAG_ACTION_LIFTED',
  'CONTRACTOR_FLAG_CLOSED',
  'APPROVED_LIST_ROW_LINKED',
  // Client demo updates (wave 4): approved list upload
  'APPROVED_LIST_IMPORTED',
  // Redesign R3
  'FORM_COMPONENT_SAVED',
  // Redesign R4: visits
  'VISITS_GENERATED',
  'VISIT_CREATED',
  'VISIT_PUBLISHED',
  'VISIT_UPDATED',
  'VISIT_CANCELLED',
  'VISIT_FORM_REBUILT',
  'VISIT_OFFICERS_SAVED',
  'VISIT_RESPONDED',
  'VISIT_DATE_DECIDED',
  'VISIT_CHECKED_IN',
  'VISIT_SUBMITTED',
  'VISIT_MISSED',
  'SITE_LOG_ADDED',
  'SITE_LOG_HIDDEN',
  'VISIT_REVIEWED',
  'FINDING_ESCALATED',
  'FINDINGS_SUMMARY_SENT',
  'SPRINT_VERIFIED',
  // Needs pipeline (N1). Cycle and proposal events go on the tenant ledger (no project).
  'NEEDS_CYCLE_OPENED',
  'NEEDS_CYCLE_UPDATED',
  'NEEDS_CYCLE_CLOSED',
  'NEEDS_PROPOSAL_CREATED',
  'NEEDS_VERSION_ADDED',
  'NEEDS_PROPOSAL_SUBMITTED',
  'NEEDS_PROPOSAL_RETURNED',
  'NEEDS_PROPOSAL_WITHDRAWN',
  'NEEDS_PROPOSAL_MERGED',
  'NEEDS_FLAG_RESOLVED',
  'NEEDS_STAGE_DECIDED',
  'NEEDS_VALIDATION_RECORDED',
  'NEEDS_COMMITTEE_UPDATED',
  'NEEDS_CONFLICT_DECLARED',
  'NEEDS_SCORE_SUBMITTED',
  'NEEDS_RANKING_FINALISED',
  'NEEDS_SUBMISSION_CREATED',
  'NEEDS_APPROVAL_ACTION',
  'NEEDS_FUNDING_RECORDED',
  'NEEDS_PROPOSAL_CONVERTED',
  'NEEDS_SEPARATION_OVERRIDDEN',
  'COSTING_STANDARD_SAVED',
  'PROJECT_CREATED_FROM_PROPOSAL',
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

export const ApprovalSubjectTypeEnum = z.enum(['CONTRACT_DEFAULT_CASE', 'VISIT_SUBMISSION']);
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


