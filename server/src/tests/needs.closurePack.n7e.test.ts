/**
 * Needs pipeline wave 4 (M4): the closure pack's `needs-assessment/` folder. A Direct Intervention
 * proposal is set up in the database at Funding (as `needs.conversion.n7a.test.ts` does), converted,
 * and given a validation record, a score sheet and an approved portfolio; the folder builder is then
 * run with a recording `add` / `skip` (the closure pack's own) so the entries can be checked.
 */
import { resetTestDatabase } from './helpers/testDb';
import { clearSeededNeedsPipeline } from './helpers/needsSeedReset';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_TEMPLATE_VERSION, normaliseSchoolName, type ParsedNeedsAssessment } from '@insite/shared';
import type { Prisma } from '@prisma/client';
import { needsFixture } from './fixtures/needs/needsFixtures';
import { DI_CONFIG, fixtureParseContext } from './fixtures/needs/needsFixtureContext';
import { parseNeedsWorkbook } from '../modules/needs/workbook/needsWorkbook';
import type { WebJwtPayload } from '../middleware/auth.middleware';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let prisma: PrismaClientType;
let tenantId = '';

async function webUser(email: string): Promise<WebJwtPayload> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: { include: { rolePermissions: { include: { permission: true } } } } } });
  return {
    tokenType: 'WEB_USER',
    userId: u.id,
    email: u.email,
    fullName: u.fullName,
    tenantId: u.tenantId!,
    isPlatformSuperAdmin: false,
    roleId: u.roleId,
    roleCode: u.role.code,
    roleName: u.role.name,
    permissions: u.role.rolePermissions.map((rp) => rp.permission.key),
    organizationId: u.organizationId!,
    mustChangePassword: false,
  };
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  await clearSeededNeedsPipeline(prisma);
  tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } })).id;
});

describe('Needs pipeline wave 4 (M4): closure pack needs-assessment/ folder', () => {
  it('a converted proposal brings its versions, validation, scores, approvals, funding and history; a project without one adds nothing', async () => {
    const { convertProposalToProject } = await import('../modules/needs/conversion/convertProposal');
    const { addNeedsAssessmentFolder } = await import('../modules/completion/closurePackNeeds');
    const by = await webUser('finance@ubec.test');
    const es = await webUser('es@ubec.test');
    const parsedResult = await parseNeedsWorkbook(needsFixture('di-design-valid'), fixtureParseContext('DI', 'DESIGN'));
    const parsed = parsedResult.parsed as ParsedNeedsAssessment;
    assert.ok(parsed, JSON.stringify(parsedResult.issues));
    const type = await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CENTRAL' } });
    const hq = await prisma.organization.findFirstOrThrow({ where: { tenantId, name: { contains: 'UBEC' } }, orderBy: { createdAt: 'asc' } });
    const cycle = await prisma.needsCycle.create({
      data: {
        tenantId,
        projectTypeId: type.id,
        interventionYear: 2027,
        scopeKey: 'NATIONAL',
        owningOrganizationId: hq.id,
        status: 'OPEN',
        configSnapshotJson: DI_CONFIG as unknown as Prisma.InputJsonValue,
        templateVersion: NEEDS_TEMPLATE_VERSION,
        openedAt: new Date(),
      },
    });
    const proposal = await prisma.needsProposal.create({
      data: {
        tenantId,
        cycleId: cycle.id,
        reference: '2027-DI-001',
        sequence: 1,
        title: parsed.project.title ?? 'Proposal',
        stage: 'FUNDING',
        status: 'IN_PROGRESS',
        stateCode: 'NI',
        lgaCodes: [...new Set(parsed.sites.map((s) => s.lgaCode))],
        costedAmountNgn: 50_000_000,
        approvedAmountNgn: 50_000_000,
        rank: 1,
        aboveLine: true,
        createdByUserId: by.userId,
        createdByName: by.fullName,
      },
    });
    const version = await prisma.needsAssessmentVersion.create({
      data: {
        proposalId: proposal.id,
        number: 1,
        source: 'UPLOAD',
        objectKey: `tenants/${tenantId}/needs/cycles/${cycle.id}/versions/missing.xlsx`,
        fileName: 'Bosso needs assessment.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: 1000,
        sha256: 'a'.repeat(64),
        templateVersion: parsed.templateVersion,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        siteCount: parsed.sites.length,
        breakdownRowCount: parsed.breakdownRows.length,
        boqLineCount: parsed.boqLines.length,
        uploadedByUserId: by.userId,
        uploadedByName: by.fullName,
      },
    });
    await prisma.needsProposal.update({ where: { id: proposal.id }, data: { currentVersionId: version.id } });
    await prisma.needsProposalSite.createMany({
      data: parsed.sites.map((s) => ({ proposalId: proposal.id, siteNumber: s.siteNumber, schoolName: s.schoolName, schoolNameKey: normaliseSchoolName(s.schoolName), schoolLevel: s.schoolLevel, lgaCode: s.lgaCode })),
    });
    await prisma.needsValidationRecord.create({
      data: { proposalId: proposal.id, versionId: version.id, outcome: 'ADVANCE', deskNotes: 'Needs confirmed.', recordedByUserId: es.userId, recordedByName: es.fullName },
    });
    const member = await prisma.needsCommitteeMember.create({ data: { cycleId: cycle.id, userId: es.userId, role: 'CHAIR' } });
    await prisma.needsScoreSheet.create({ data: { cycleId: cycle.id, proposalId: proposal.id, memberId: member.id, scoresJson: { strategic_alignment: 5 }, comment: 'Strong case' } });
    const portfolio = await prisma.needsSubmission.create({
      data: { cycleId: cycle.id, kind: 'PORTFOLIO', status: 'APPROVED', submittedByName: 'Procurement', submittedAt: new Date(), decidedAt: new Date(), createdByUserId: by.userId, createdByName: by.fullName },
    });
    await prisma.needsSubmissionItem.create({ data: { submissionId: portfolio.id, proposalId: proposal.id, included: true, amountNgn: 50_000_000 } });
    await prisma.needsFundingRecord.create({
      data: { cycleId: cycle.id, kind: 'BUDGET_SUBMISSION', recordedOn: '2026-12-15', amountNgn: 50_000_000, recordedByUserId: by.userId, recordedByName: by.fullName },
    });

    const converted = await prisma.$transaction((tx) => convertProposalToProject(tx, proposal, { fundedAmountNgn: 48_000_000, by }));

    const added: Array<{ path: string; data: Buffer }> = [];
    const skipped: Array<{ path: string; note: string }> = [];
    const wrote = await addNeedsAssessmentFolder(
      converted.projectId,
      (path, data) => (added.push({ path, data }), path),
      (path, _source, note) => void skipped.push({ path, note }),
      30 * 1024 * 1024
    );
    assert.equal(wrote, true);
    assert.deepEqual(added.map((a) => a.path).sort(), [
      'needs-assessment/approvals-and-funding.json',
      'needs-assessment/proposal-history.csv',
      'needs-assessment/score-sheets.csv',
      'needs-assessment/validation-records.csv',
    ]);
    // The version file is not in storage here: listed in the manifest with the reason, never silently dropped.
    assert.deepEqual(skipped.map((s) => [s.path, s.note]), [['needs-assessment/versions/v1-upload-Bosso needs assessment.xlsx', 'The stored file could not be read.']]);
    const record = JSON.parse(added.find((a) => a.path.endsWith('approvals-and-funding.json'))!.data.toString('utf8'));
    assert.equal(record.proposal.reference, '2027-DI-001');
    assert.equal(record.proposal.amountsNgn.funded, 48_000_000);
    assert.equal(record.projectOrigin, 'Annual needs assessment');
    assert.deepEqual(record.approvals.map((a: { kind: string; status: string }) => [a.kind, a.status]), [['PORTFOLIO', 'APPROVED']]);
    assert.deepEqual(record.funding.map((f: { kind: string }) => f.kind), ['BUDGET_SUBMISSION']);
    assert.match(added.find((a) => a.path.endsWith('validation-records.csv'))!.data.toString('utf8'), /ADVANCE,Needs confirmed\./);
    assert.match(added.find((a) => a.path.endsWith('proposal-history.csv'))!.data.toString('utf8'), /NEEDS_PROPOSAL_CONVERTED/);

    const legacy = await prisma.project.findFirstOrThrow({ where: { tenantId, needsProposalId: null } });
    assert.equal(await addNeedsAssessmentFolder(legacy.id, () => '', () => undefined, 1), false);
  });
});
