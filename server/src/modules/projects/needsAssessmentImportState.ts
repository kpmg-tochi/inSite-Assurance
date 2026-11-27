import { NeedsAssessmentImportStateSchema, type NeedsAssessmentFieldKey, type NeedsAssessmentImportState } from '@insite/shared';
import { prisma } from '../../config/prisma';

/**
 * The setup DTO's `needsAssessmentImport` for drafts made by the client demo D1 flow ("Upload needs
 * assessment" on New project). Needs pipeline wave 4 (M2) removed that flow
 * (`/projects/from-needs-assessment`); drafts it made keep their "From needs assessment" / "Needs
 * your input" tags, so the reader stays here. New drafts have none.
 */

/** The keys such a draft still lacks (the wizard's "Needs your input"). */
async function missingKeys(projectId: string): Promise<NeedsAssessmentFieldKey[]> {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      tenantId: true,
      name: true,
      projectTypeId: true,
      interventionYear: true,
      lotId: true,
      stateCode: true,
      fundingSourceCode: true,
      totalBudgetNgn: true,
      _count: { select: { boqItems: true } },
    },
  });
  if (!p) return [];
  const hasTypes = (await prisma.projectType.count({ where: { tenantId: p.tenantId, isActive: true } })) > 0;
  const out: NeedsAssessmentFieldKey[] = [];
  if (!p.name?.trim()) out.push('name');
  if (hasTypes && !p.projectTypeId) out.push('projectTypeId');
  if (p.interventionYear === null) out.push('interventionYear');
  if (!p.lotId) out.push('lot');
  if (!p.stateCode) out.push('stateCode');
  if (!p.fundingSourceCode) out.push('fundingSourceCode');
  if (p.totalBudgetNgn === null) out.push('totalBudgetNgn');
  if (p._count.boqItems === 0) out.push('scope');
  return out;
}

/**
 * What the D1 confirm stored in `setupState.needsAssessment`, with `needsInput` recomputed; the
 * SCOPE_IMPORTED audit payload is the fallback when a later setupState write did not keep the key.
 */
export async function getNeedsAssessmentImportState(projectId: string): Promise<NeedsAssessmentImportState | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { setupState: true } });
  if (!project) return null;
  const raw = (project.setupState as Record<string, unknown> | null)?.needsAssessment;
  let stored = NeedsAssessmentImportStateSchema.safeParse(raw).data ?? null;
  if (!stored) {
    const entry = await prisma.auditLog.findFirst({
      where: { projectId, action: 'SCOPE_IMPORTED', payload: { path: ['needsAssessmentFirst'], equals: true } },
      orderBy: { seq: 'asc' },
      select: { createdAt: true, payload: true },
    });
    if (!entry) return null;
    const payload = entry.payload as { fileName?: string | null; filled?: unknown };
    stored =
      NeedsAssessmentImportStateSchema.safeParse({
        importedAt: entry.createdAt.toISOString(),
        fileName: payload.fileName ?? null,
        filled: Array.isArray(payload.filled) ? payload.filled : [],
        needsInput: [],
      }).data ?? null;
    if (!stored) return null;
  }
  return { ...stored, needsInput: await missingKeys(projectId) };
}
