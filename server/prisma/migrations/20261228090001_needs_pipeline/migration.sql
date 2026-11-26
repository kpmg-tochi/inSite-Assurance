-- Needs pipeline wave 1 (N1), part 2 of 2: cycles, proposed projects, versions, decisions, committee,
-- submissions, cycle approval chains (D-N.23), costing standards, Project.origin. Additive only.

-- CreateEnum
CREATE TYPE "ProjectOrigin" AS ENUM ('NEEDS_PIPELINE', 'OUT_OF_CYCLE', 'REGISTER_IMPORT', 'LEGACY');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "needsProposalId" UUID,
ADD COLUMN     "origin" "ProjectOrigin";

-- CreateTable
CREATE TABLE "needs_cycles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectTypeId" UUID NOT NULL,
    "interventionYear" INTEGER NOT NULL,
    "stateCode" TEXT,
    "scopeKey" TEXT NOT NULL,
    "owningOrganizationId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "configSnapshotJson" JSONB NOT NULL,
    "deadlinesJson" JSONB NOT NULL DEFAULT '[]',
    "templateVersion" TEXT NOT NULL,
    "costingStandardVersionId" UUID,
    "indicativeCeilingNgn" DECIMAL(18,2),
    "proposalSequence" INTEGER NOT NULL DEFAULT 0,
    "fundingLinePosition" INTEGER,
    "rankingFinalisedAt" TIMESTAMP(3),
    "rankingFinalisedByUserId" UUID,
    "rankingFinalisedByName" TEXT,
    "createdByUserId" UUID,
    "openedAt" TIMESTAMP(3),
    "openedByUserId" UUID,
    "openedByName" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByUserId" UUID,
    "closedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "needs_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_cycle_documents" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "supersedesId" UUID,
    "coveredProposalIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "uploadedByUserId" UUID NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "needs_cycle_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_proposals" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "route" TEXT NOT NULL DEFAULT 'ANNUAL',
    "outOfCycleReason" TEXT,
    "authorisingDocumentId" UUID,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "statusReason" TEXT,
    "stateCode" TEXT,
    "lgaCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currentVersionId" UUID,
    "preliminaryAmountNgn" DECIMAL(18,2),
    "costedAmountNgn" DECIMAL(18,2),
    "approvedAmountNgn" DECIMAL(18,2),
    "fundedAmountNgn" DECIMAL(18,2),
    "scoreImpact" DECIMAL(5,2),
    "scoreEase" DECIMAL(5,2),
    "scoreTotal" DECIMAL(5,2),
    "rank" INTEGER,
    "aboveLine" BOOLEAN,
    "lineOverrideReason" TEXT,
    "carriedFromId" UUID,
    "mergedIntoId" UUID,
    "createdByUserId" UUID NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "needs_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_assessment_versions" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "costingStandardVersionId" UUID,
    "parsedJson" JSONB NOT NULL,
    "siteCount" INTEGER NOT NULL DEFAULT 0,
    "breakdownRowCount" INTEGER NOT NULL DEFAULT 0,
    "boqLineCount" INTEGER NOT NULL DEFAULT 0,
    "preliminaryCostNgn" DECIMAL(18,2),
    "costedTotalNgn" DECIMAL(18,2),
    "uploadedByUserId" UUID NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "needs_assessment_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_proposal_sites" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "siteNumber" INTEGER NOT NULL,
    "schoolName" TEXT NOT NULL,
    "schoolNameKey" TEXT NOT NULL,
    "schoolLevel" TEXT NOT NULL,
    "lgaCode" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "enrolment" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "needs_proposal_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_facility_breakdown_rows" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "siteNumber" INTEGER NOT NULL,
    "unitId" TEXT NOT NULL,
    "facilityCode" TEXT NOT NULL,
    "interventionAction" TEXT NOT NULL,
    "existingQuantity" DECIMAL(14,3) NOT NULL,
    "existingCondition" TEXT NOT NULL,
    "requiredQuantity" DECIMAL(14,3) NOT NULL,
    "proposedQuantity" DECIMAL(14,3) NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "preliminaryCostNgn" DECIMAL(18,2),
    "technicalJustification" TEXT NOT NULL,
    "criticality" TEXT NOT NULL,
    "supportingEvidence" TEXT,
    "evidenceDocumentIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "needs_facility_breakdown_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_proposal_documents" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "supersedesId" UUID,
    "uploadedByUserId" UUID NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "needs_proposal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_proposal_flags" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "detailsJson" JSONB NOT NULL DEFAULT '{}',
    "raisedOnVersionId" UUID,
    "raisedOnVersionNumber" INTEGER,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" UUID,
    "resolvedByName" TEXT,
    "resolution" TEXT,
    "resolutionReason" TEXT,

    CONSTRAINT "needs_proposal_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_validation_records" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "deskNotes" TEXT,
    "siteVerificationJson" JSONB,
    "duplicateResolutionsJson" JSONB NOT NULL DEFAULT '[]',
    "recordedByUserId" UUID NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "needs_validation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_stage_decisions" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "reason" TEXT,
    "evidenceDocumentIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "decidedByUserId" UUID NOT NULL,
    "decidedByName" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "needs_stage_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_stage_decision_items" (
    "id" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "toStage" TEXT,
    "toStatus" TEXT,

    CONSTRAINT "needs_stage_decision_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_committee_members" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "conflictDeclaredAt" TIMESTAMP(3),
    "conflictStatement" TEXT,
    "conflictedProposalIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "addedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "needs_committee_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_score_sheets" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "scoresJson" JSONB NOT NULL,
    "comment" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "needs_score_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_submissions" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "chainVersion" INTEGER NOT NULL DEFAULT 1,
    "currentStepOrder" INTEGER DEFAULT 0,
    "submittedByUserId" UUID,
    "submittedByName" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "memoDocumentId" UUID,
    "counterpartDeclaredNgn" DECIMAL(18,2),
    "counterpartEvidenceDocumentId" UUID,
    "createdByUserId" UUID NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "needs_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_submission_items" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "exclusionReason" TEXT,
    "amountNgn" DECIMAL(18,2),
    "lotTitle" TEXT,
    "lotNumber" INTEGER,
    "batchNumber" INTEGER,
    "procurementMethod" TEXT,
    "reviewOutcome" TEXT,
    "reviewComment" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "needs_submission_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_approval_steps" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "chainType" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "requiredPermissionKey" TEXT NOT NULL,
    "requiredRoleId" UUID,
    "minAmountThresholdNgn" DECIMAL(18,2),
    "isSystemStep" BOOLEAN NOT NULL DEFAULT false,
    "organizationScope" "ApprovalOrganizationScope" NOT NULL DEFAULT 'ANY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "needs_approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_approval_actions" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "chainType" TEXT NOT NULL,
    "subjectId" UUID NOT NULL,
    "stepId" UUID NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "needs_approval_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "costing_standard_versions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "ratesJson" JSONB NOT NULL DEFAULT '[]',
    "zoneFactorsJson" JSONB NOT NULL DEFAULT '{}',
    "supervisionMonitoringPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "contingencyPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "ceilingsJson" JSONB NOT NULL DEFAULT '[]',
    "designStandardDocumentIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "note" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "savedByUserId" UUID,
    "savedByName" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "costing_standard_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "needs_cycles_tenantId_interventionYear_idx" ON "needs_cycles"("tenantId", "interventionYear");

-- CreateIndex
CREATE INDEX "needs_cycles_owningOrganizationId_idx" ON "needs_cycles"("owningOrganizationId");

-- CreateIndex
CREATE INDEX "needs_cycles_projectTypeId_idx" ON "needs_cycles"("projectTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "needs_cycles_tenantId_projectTypeId_interventionYear_scopeK_key" ON "needs_cycles"("tenantId", "projectTypeId", "interventionYear", "scopeKey");

-- CreateIndex
CREATE INDEX "needs_cycle_documents_cycleId_kind_idx" ON "needs_cycle_documents"("cycleId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "needs_proposals_currentVersionId_key" ON "needs_proposals"("currentVersionId");

-- CreateIndex
CREATE INDEX "needs_proposals_cycleId_stage_status_idx" ON "needs_proposals"("cycleId", "stage", "status");

-- CreateIndex
CREATE INDEX "needs_proposals_tenantId_stateCode_idx" ON "needs_proposals"("tenantId", "stateCode");

-- CreateIndex
CREATE INDEX "needs_proposals_carriedFromId_idx" ON "needs_proposals"("carriedFromId");

-- CreateIndex
CREATE INDEX "needs_proposals_mergedIntoId_idx" ON "needs_proposals"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "needs_proposals_tenantId_reference_key" ON "needs_proposals"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "needs_proposals_cycleId_sequence_key" ON "needs_proposals"("cycleId", "sequence");

-- CreateIndex
CREATE INDEX "needs_assessment_versions_costingStandardVersionId_idx" ON "needs_assessment_versions"("costingStandardVersionId");

-- CreateIndex
CREATE INDEX "needs_assessment_versions_sha256_idx" ON "needs_assessment_versions"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "needs_assessment_versions_proposalId_number_key" ON "needs_assessment_versions"("proposalId", "number");

-- CreateIndex
CREATE INDEX "needs_proposal_sites_lgaCode_schoolNameKey_idx" ON "needs_proposal_sites"("lgaCode", "schoolNameKey");

-- CreateIndex
CREATE UNIQUE INDEX "needs_proposal_sites_proposalId_siteNumber_key" ON "needs_proposal_sites"("proposalId", "siteNumber");

-- CreateIndex
CREATE INDEX "needs_facility_breakdown_rows_proposalId_siteNumber_idx" ON "needs_facility_breakdown_rows"("proposalId", "siteNumber");

-- CreateIndex
CREATE INDEX "needs_facility_breakdown_rows_facilityCode_idx" ON "needs_facility_breakdown_rows"("facilityCode");

-- CreateIndex
CREATE UNIQUE INDEX "needs_facility_breakdown_rows_proposalId_unitId_key" ON "needs_facility_breakdown_rows"("proposalId", "unitId");

-- CreateIndex
CREATE INDEX "needs_proposal_documents_proposalId_kind_idx" ON "needs_proposal_documents"("proposalId", "kind");

-- CreateIndex
CREATE INDEX "needs_proposal_flags_proposalId_kind_idx" ON "needs_proposal_flags"("proposalId", "kind");

-- CreateIndex
CREATE INDEX "needs_proposal_flags_proposalId_resolvedAt_idx" ON "needs_proposal_flags"("proposalId", "resolvedAt");

-- CreateIndex
CREATE INDEX "needs_validation_records_proposalId_recordedAt_idx" ON "needs_validation_records"("proposalId", "recordedAt");

-- CreateIndex
CREATE INDEX "needs_validation_records_versionId_idx" ON "needs_validation_records"("versionId");

-- CreateIndex
CREATE INDEX "needs_stage_decisions_cycleId_stage_idx" ON "needs_stage_decisions"("cycleId", "stage");

-- CreateIndex
CREATE INDEX "needs_stage_decision_items_proposalId_idx" ON "needs_stage_decision_items"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "needs_stage_decision_items_decisionId_proposalId_key" ON "needs_stage_decision_items"("decisionId", "proposalId");

-- CreateIndex
CREATE INDEX "needs_committee_members_userId_idx" ON "needs_committee_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "needs_committee_members_cycleId_userId_key" ON "needs_committee_members"("cycleId", "userId");

-- CreateIndex
CREATE INDEX "needs_score_sheets_cycleId_idx" ON "needs_score_sheets"("cycleId");

-- CreateIndex
CREATE INDEX "needs_score_sheets_memberId_idx" ON "needs_score_sheets"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "needs_score_sheets_proposalId_memberId_key" ON "needs_score_sheets"("proposalId", "memberId");

-- CreateIndex
CREATE INDEX "needs_submissions_cycleId_kind_status_idx" ON "needs_submissions"("cycleId", "kind", "status");

-- CreateIndex
CREATE INDEX "needs_submission_items_proposalId_idx" ON "needs_submission_items"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "needs_submission_items_submissionId_proposalId_key" ON "needs_submission_items"("submissionId", "proposalId");

-- CreateIndex
CREATE INDEX "needs_approval_steps_cycleId_chainType_isActive_idx" ON "needs_approval_steps"("cycleId", "chainType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "needs_approval_steps_cycleId_chainType_version_stepOrder_key" ON "needs_approval_steps"("cycleId", "chainType", "version", "stepOrder");

-- CreateIndex
CREATE INDEX "needs_approval_actions_subjectId_createdAt_idx" ON "needs_approval_actions"("subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "needs_approval_actions_cycleId_chainType_idx" ON "needs_approval_actions"("cycleId", "chainType");

-- CreateIndex
CREATE UNIQUE INDEX "costing_standard_versions_tenantId_version_key" ON "costing_standard_versions"("tenantId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Project_needsProposalId_key" ON "Project"("needsProposalId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_needsProposalId_fkey" FOREIGN KEY ("needsProposalId") REFERENCES "needs_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_cycles" ADD CONSTRAINT "needs_cycles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_cycles" ADD CONSTRAINT "needs_cycles_projectTypeId_fkey" FOREIGN KEY ("projectTypeId") REFERENCES "project_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_cycles" ADD CONSTRAINT "needs_cycles_owningOrganizationId_fkey" FOREIGN KEY ("owningOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_cycles" ADD CONSTRAINT "needs_cycles_costingStandardVersionId_fkey" FOREIGN KEY ("costingStandardVersionId") REFERENCES "costing_standard_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_cycle_documents" ADD CONSTRAINT "needs_cycle_documents_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "needs_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_cycle_documents" ADD CONSTRAINT "needs_cycle_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "needs_cycle_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_proposals" ADD CONSTRAINT "needs_proposals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_proposals" ADD CONSTRAINT "needs_proposals_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "needs_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_proposals" ADD CONSTRAINT "needs_proposals_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "needs_assessment_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_proposals" ADD CONSTRAINT "needs_proposals_carriedFromId_fkey" FOREIGN KEY ("carriedFromId") REFERENCES "needs_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_proposals" ADD CONSTRAINT "needs_proposals_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "needs_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_assessment_versions" ADD CONSTRAINT "needs_assessment_versions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "needs_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_assessment_versions" ADD CONSTRAINT "needs_assessment_versions_costingStandardVersionId_fkey" FOREIGN KEY ("costingStandardVersionId") REFERENCES "costing_standard_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_proposal_sites" ADD CONSTRAINT "needs_proposal_sites_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "needs_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_facility_breakdown_rows" ADD CONSTRAINT "needs_facility_breakdown_rows_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "needs_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_proposal_documents" ADD CONSTRAINT "needs_proposal_documents_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "needs_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_proposal_documents" ADD CONSTRAINT "needs_proposal_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "needs_proposal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_proposal_flags" ADD CONSTRAINT "needs_proposal_flags_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "needs_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_validation_records" ADD CONSTRAINT "needs_validation_records_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "needs_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_validation_records" ADD CONSTRAINT "needs_validation_records_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "needs_assessment_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_stage_decisions" ADD CONSTRAINT "needs_stage_decisions_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "needs_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_stage_decision_items" ADD CONSTRAINT "needs_stage_decision_items_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "needs_stage_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_stage_decision_items" ADD CONSTRAINT "needs_stage_decision_items_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "needs_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_committee_members" ADD CONSTRAINT "needs_committee_members_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "needs_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_committee_members" ADD CONSTRAINT "needs_committee_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_score_sheets" ADD CONSTRAINT "needs_score_sheets_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "needs_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_score_sheets" ADD CONSTRAINT "needs_score_sheets_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "needs_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_score_sheets" ADD CONSTRAINT "needs_score_sheets_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "needs_committee_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_submissions" ADD CONSTRAINT "needs_submissions_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "needs_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_submission_items" ADD CONSTRAINT "needs_submission_items_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "needs_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_submission_items" ADD CONSTRAINT "needs_submission_items_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "needs_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_approval_steps" ADD CONSTRAINT "needs_approval_steps_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "needs_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_approval_actions" ADD CONSTRAINT "needs_approval_actions_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "needs_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_approval_actions" ADD CONSTRAINT "needs_approval_actions_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "needs_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_approval_actions" ADD CONSTRAINT "needs_approval_actions_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "needs_approval_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_approval_actions" ADD CONSTRAINT "needs_approval_actions_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costing_standard_versions" ADD CONSTRAINT "costing_standard_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- D-N.13: every project that exists when this migration runs is LEGACY. No database default: new
-- rows get their origin in code (conversion, out-of-cycle approval, register import).
UPDATE "Project" SET "origin" = 'LEGACY' WHERE "origin" IS NULL;

-- Permission rows (owned by code, synced at start; inserted here so the grant below has rows)
INSERT INTO "permissions" ("id", "key", "name", "description", "category", "surface") VALUES
  (gen_random_uuid(), 'needs:view', 'View Needs Assessment Cycles', 'See the needs assessment cycles of the user''s organisation and those below it: proposed projects, versions, decisions and cycle documents.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:manage_cycle', 'Open & Manage Cycles', 'Open and close an annual cycle, set its deadlines, template and costing standard versions and indicative ceiling, form the steering committee, and carry proposed projects forward.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:submit', 'Upload Needs Assessments', 'Upload draft needs assessments and corrections as proposed projects, add their documents and submit them for validation.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:validate', 'Validate Proposed Projects', 'Record the desk review and site verification of a proposed project, resolve duplicate and essential-facility flags, and validate or return it. Not for a needs assessment the same person uploaded.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:cost', 'Cost Proposed Projects', 'Upload the costed needs assessment, acknowledge rate and ceiling flags, and sign off the cost. Not for a proposed project the same person validated.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:score', 'Score Proposed Projects', 'Can be named to a cycle''s steering committee: declares conflicts of interest and scores proposed projects against the rubric.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:chair_committee', 'Chair the Steering Committee', 'See every score, set the funding line, override the ranking with a reason and finalise the Prioritised Project Portfolio.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:submit_portfolio', 'Submit the Prioritised Portfolio', 'Submit the Prioritised Project Portfolio for approval.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:review_portfolio', 'Review the Portfolio', 'Act on the management review step of the portfolio approval.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:approve_portfolio', 'Approve the Portfolio', 'Approve the portfolio, exclude proposed projects with a reason and attach the signed memo (Executive Secretary; SUBEB Executive Chairman).', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:record_funding', 'Record Budget & Appropriation', 'Record the budget submission and import the appropriated schedule, which turns funded proposed projects into draft projects. Not by the person who approved the portfolio.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:prepare_beap', 'Prepare the BEAP', 'Build a State''s Basic Education Action Plan (BEAP) from its approved proposed projects (lots, procurement method, counterpart funding), submit it to UBEC and revise it.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:review_beap', 'Review BEAPs', 'Review a State''s BEAP for UBEC: accept, comment on or ask to remove each proposed project, and return the BEAP for revision.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:approve_beap', 'Approve BEAPs', 'Approve a State''s BEAP for UBEC Executive Management, which turns its proposed projects into draft projects.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:approve_out_of_cycle', 'Approve Out-of-Cycle Projects', 'Approve a project proposed outside the annual cycle (emergency, directive, supplementary budget) on its authorising document.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'needs:override_separation', 'Override Separation of Duties', 'Let one person act on two stages of a proposed project where there is nobody else, with a recorded reason; the override is flagged on the proposed project. Grant sparingly.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'standards:manage', 'Manage Costing & Design Standards', 'Maintain the costing standards (rates, zone factors, cost ceilings, the supervision and monitoring share) and the design standard documents.', 'NEEDS_FUNDING', 'WEB'),
  (gen_random_uuid(), 'procurement:plan_lots', 'Plan Procurement Lots', 'Assign lots and batches to funded draft projects for the procurement plan.', 'PORTFOLIO_PROJECTS', 'WEB')
ON CONFLICT ("key") DO NOTHING;

-- Existing tenant administrators hold every permission; other roles are granted in the seed
-- (plan section 8) until the role catalogue migration.
INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r, "permissions" p
WHERE p."key" IN ('needs:view', 'needs:manage_cycle', 'needs:submit', 'needs:validate', 'needs:cost', 'needs:score', 'needs:chair_committee', 'needs:submit_portfolio', 'needs:review_portfolio', 'needs:approve_portfolio', 'needs:record_funding', 'needs:prepare_beap', 'needs:review_beap', 'needs:approve_beap', 'needs:approve_out_of_cycle', 'needs:override_separation', 'standards:manage', 'procurement:plan_lots') AND r."code" = 'TENANT_SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
