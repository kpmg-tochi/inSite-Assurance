import { z } from 'zod';

/**
 * 1. Web Portal User Roles
 * Segregated workspaces as defined in Section 4.A of the specification.
 */
export const UserRoleEnum = z.enum([
  'MONITOR',    // Independent Monitor / QS / Lender Monitoring Manager (The Certifier)
  'LENDER',     // Lender / Guarantor / Credit Risk Officer (The Approver)
  'CONTRACTOR', // Contractor / Project Sponsor (The Claimant — Segregated Surface)
]);
export type UserRole = z.infer<typeof UserRoleEnum>;

/**
 * 1b. Nigerian Professional Regulatory License Types
 * Used on User and ValuationReport to validate and format certifier credentials.
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
 * 2. Field Reporter Independence Tiers
 * Bound via the role-specific Project Join Code (Section 4.B).
 */
export const IndependenceTierEnum = z.enum([
  'MONITOR_INSPECTOR',    // Visiting QS/Engineer from Independent Monitoring firm or Bank unit
  'INDEPENDENT_RESIDENT', // Full-time on-site Clerk of Works / Resident Engineer
  'CONTRACTOR_ENGINEER',  // Main Contractor's Site Engineer submitting periodic/hold-point logs
]);
export type IndependenceTier = z.infer<typeof IndependenceTierEnum>;

export interface IndependenceTierMetadata {
  tier: IndependenceTier;
  codeSuffix: 'INS' | 'COW' | 'CON';
  label: string;
  shortBadge: string;
  assuranceWeight: number; // 1.0 (Highest) -> 0.4 (Self-report, requires corroboration)
  requiresCorroborationForHighValue: boolean;
}

export const INDEPENDENCE_TIER_META: Record<IndependenceTier, IndependenceTierMetadata> = {
  MONITOR_INSPECTOR: {
    tier: 'MONITOR_INSPECTOR',
    codeSuffix: 'INS',
    label: 'Monitor Inspector (Visiting QS / COREN)',
    shortBadge: 'Monitor Inspector',
    assuranceWeight: 1.0,
    requiresCorroborationForHighValue: false,
  },
  INDEPENDENT_RESIDENT: {
    tier: 'INDEPENDENT_RESIDENT',
    codeSuffix: 'COW',
    label: 'Independent Resident Clerk of Works',
    shortBadge: 'Independent CoW',
    assuranceWeight: 0.85,
    requiresCorroborationForHighValue: false,
  },
  CONTRACTOR_ENGINEER: {
    tier: 'CONTRACTOR_ENGINEER',
    codeSuffix: 'CON',
    label: 'Contractor Site Engineer (Self-Report)',
    shortBadge: 'Contractor Engineer',
    assuranceWeight: 0.4,
    requiresCorroborationForHighValue: true,
  },
};

/**
 * 3. Geofence Modes (Section 3.3 & 4.A)
 */
export const GeofenceModeEnum = z.enum([
  'RADIAL',          // Point Radius (e.g., 300m around a building, factory, or substation)
  'LINEAR_CORRIDOR', // Linear Corridor / Chainage polyline buffer (roads, pipelines, transmission lines)
]);
export type GeofenceMode = z.infer<typeof GeofenceModeEnum>;

/**
 * 4. Configurable Field Reporting Cadences (Section 3.2 & 4.A)
 */
export const ReportingCadenceEnum = z.enum([
  'DAILY',
  'WEEKLY',
  'BI_WEEKLY',
  'INSPECTION_ONLY', // Hold-Point / Milestone Triggered
]);
export type ReportingCadence = z.infer<typeof ReportingCadenceEnum>;

/**
 * 5. AI Evidence Strength Ratings (Section 1 & 7.1)
 * Software assigns an Evidence Strength Rating, NEVER a legally certified completion %.
 */
export const EvidenceStrengthRatingEnum = z.enum([
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'UNSUPPORTED',
  'CONTRADICTED',
]);
export type EvidenceStrengthRating = z.infer<typeof EvidenceStrengthRatingEnum>;

export const EVIDENCE_RATING_META: Record<
  EvidenceStrengthRating,
  { label: string; colorToken: 'emerald' | 'amber' | 'slate' | 'rose'; description: string }
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
 * 6. Portfolio Geospatial Health Pins (Section 4.A Role 2)
 */
export const PortfolioHealthEnum = z.enum([
  'EVIDENCE_SUPPORTED', // Green pin
  'EVIDENCE_PARTIAL',   // Amber pin
  'EVIDENCE_CONFLICT',  // Red pin
]);
export type PortfolioHealth = z.infer<typeof PortfolioHealthEnum>;

/**
 * 7. Field Evidence Log Lifecycle States (Hybrid Offline-First + Mandatory Human Confirmation)
 */
export const EvidenceLogStatusEnum = z.enum([
  'LOCAL_CAPTURED',        // Captured on device (live camera/audio)
  'QUEUED_OFFLINE',        // Turf.js geofence checked & signed locally in Expo SQLite outbox
  'UPLOADING_SYNC',        // Media uploading to S3/R2
  'AWAITING_CONFIRMATION', // Azure Whisper + GPT-4o extracted quantities; waiting for Field Agent sign-off
  'CONFIRMED',             // Human confirmed & signed; visible in Monitor's Reconciliation Workbench
  'FLAGGED_INTEGRITY',     // Failed mock-location, pHash duplicate check, or clock-drift validation
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
]);
export type AuditActorType = z.infer<typeof AuditActorTypeEnum>;

export const AuditActionTypeEnum = z.enum([
  'PROJECT_CREATED',
  'BASELINE_UPDATED',
  'BOQ_UPLOADED',
  'JOIN_CODE_ISSUED',
  'FIELD_AGENT_JOINED',
  'EVIDENCE_EXTRACTED',
  'EVIDENCE_CONFIRMED',
  'EVIDENCE_FLAGGED_INTEGRITY',
  'IPC_SUBMITTED',
  'AI_RECONCILIATION_COMPLETED',
  'MONITOR_QUERY_RAISED',
  'CONTRACTOR_QUERY_RESPONDED',
  'VALUATION_REPORT_CERTIFIED',
  'LENDER_TRANCHE_DECIDED',
]);
export type AuditActionType = z.infer<typeof AuditActionTypeEnum>;

