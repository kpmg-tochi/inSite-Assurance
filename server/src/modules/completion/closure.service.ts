import { Prisma } from '@prisma/client';
import {
  AUTOMATIC_CLOSURE_ITEM_KINDS,
  CLOSURE_ITEM_KIND_META,
  ClosureChecklistItemDto,
  ClosureChecklistItemStatus,
  ClosureChecklistItemTemplate,
  ClosureChecklistList,
  CONTRACTOR_RATING_STAGE_META,
  INSPECTION_VISIT_TYPE_LABELS,
  ProjectClosureChecklistDto,
  resolveProjectTypeConfig,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { registerEvidence } from '../documents/documents.service';

/**
 * Phase 15 Step 5: the closure checklist. Items come from the project type snapshot
 * (`closure.beforeClose` gates COMPLETED_CLOSED, `closure.beforeArchive` gates ARCHIVED); their
 * state is stored per project from the moment the project enters handover. Automatic kinds are
 * evaluated live; manual and audit items are ticked by permission. Waivers need a reason (the audit
 * sign-off cannot be waived). Closing and archiving freeze what is met at that moment.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const LIST_FIELD: Record<ClosureChecklistList, 'beforeClose' | 'beforeArchive'> = {
  BEFORE_CLOSE: 'beforeClose',
  BEFORE_ARCHIVE: 'beforeArchive',
};

function templatesOf(snapshot: unknown): Record<ClosureChecklistList, ClosureChecklistItemTemplate[]> {
  const closure = resolveProjectTypeConfig(snapshot)?.closure;
  return { BEFORE_CLOSE: closure?.beforeClose ?? [], BEFORE_ARCHIVE: closure?.beforeArchive ?? [] };
}

async function snapshotOf(db: Db, projectId: string) {
  return db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { projectTypeSnapshotJson: true, constructionPhase: true, status: true },
  });
}

/** Creates the stored rows of the type's items (idempotent). */
export async function ensureClosureChecklist(tx: Tx, projectId: string): Promise<number> {
  const project = await snapshotOf(tx, projectId);
  const templates = templatesOf(project.projectTypeSnapshotJson);
  const data = (['BEFORE_CLOSE', 'BEFORE_ARCHIVE'] as const).flatMap((list) => templates[list].map((t) => ({ projectId, list, itemKey: t.key })));
  if (data.length === 0) return 0;
  const created = await tx.closureChecklistItemState.createMany({ data, skipDuplicates: true });
  return created.count;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

interface Evaluation {
  met: boolean;
  detail: string | null;
}

async function evaluateItems(db: Db, projectId: string, items: ClosureChecklistItemTemplate[]): Promise<Map<string, Evaluation>> {
  const out = new Map<string, Evaluation>();
  const codes = [...new Set(items.filter((i) => i.kind === 'DOCUMENT_TYPE').map((i) => i.documentTypeCode!))];
  const needsInspections = items.some((i) => i.kind === 'INSPECTION_VISIT_TYPE');
  const milestoneKeys = [...new Set(items.filter((i) => i.kind === 'CONTRACT_MILESTONE').map((i) => i.milestoneKey!))];
  const needsRatings = items.some((i) => i.kind === 'CONTRACTOR_RATINGS');
  const needsLessons = items.some((i) => i.kind === 'LESSONS_LEARNED');
  const [evidence, inspections, milestones, contractors, ratings, lessons] = await Promise.all([
    registerEvidence(db, projectId, codes),
    needsInspections
      ? db.siteInspectionReport.findMany({ where: { projectId, status: { in: ['APPROVED', 'SUBMITTED'] } }, select: { visitType: true, visitDate: true } })
      : [],
    milestoneKeys.length ? db.projectContractMilestone.findMany({ where: { projectId, key: { in: milestoneKeys } }, select: { key: true, status: true, dueDate: true } }) : [],
    needsRatings ? db.projectContractor.findMany({ where: { projectId }, select: { id: true } }) : [],
    needsRatings ? db.contractorPerformanceRating.findMany({ where: { projectId }, select: { projectContractorId: true, stage: true } }) : [],
    needsLessons ? db.lessonLearned.count({ where: { projectId, status: 'PUBLISHED' } }) : 0,
  ]);
  const types = codes.length
    ? await db.documentType.findMany({
        where: { code: { in: codes }, tenant: { projects: { some: { id: projectId } } } },
        select: { code: true, name: true },
      })
    : [];
  const typeName = new Map(types.map((t) => [t.code, t.name]));

  for (const item of items) {
    switch (item.kind) {
      case 'DOCUMENT_TYPE': {
        const docs = evidence.filter((e) => e.typeCode === item.documentTypeCode);
        const name = typeName.get(item.documentTypeCode!) ?? item.documentTypeCode!;
        const needSign = (d: (typeof docs)[number]) => item.requireSignOff && d.requiresSignOff;
        const ok = docs.find((d) => !needSign(d) || d.currentSignerIds.length > 0);
        out.set(item.key, {
          met: Boolean(ok),
          detail: ok ? `"${ok.title}" filed${needSign(ok) ? ' and signed' : ''}.` : docs.length ? `"${docs[0].title}" filed, awaiting a sign-off.` : `No ${name.toLowerCase()} in the register.`,
        });
        break;
      }
      case 'INSPECTION_VISIT_TYPE': {
        const found = inspections.filter((i) => i.visitType === item.inspectionVisitType).sort((a, b) => b.visitDate.localeCompare(a.visitDate));
        const label = INSPECTION_VISIT_TYPE_LABELS[item.inspectionVisitType!].toLowerCase();
        out.set(item.key, { met: found.length > 0, detail: found.length ? `Approved ${label} of ${found[0].visitDate}.` : `No approved ${label}.` });
        break;
      }
      case 'CONTRACT_MILESTONE': {
        const rows = milestones.filter((m) => m.key === item.milestoneKey);
        const open = rows.filter((m) => m.status !== 'DONE' && m.status !== 'WAIVED');
        out.set(item.key, {
          met: rows.length > 0 && open.length === 0,
          detail:
            rows.length === 0
              ? `No milestone "${item.milestoneKey}" on this project.`
              : open.length === 0
                ? 'Done.'
                : open[0].dueDate
                  ? `Due ${open[0].dueDate}.`
                  : 'Not due yet (its anchor has not happened).',
        });
        break;
      }
      case 'CONTRACTOR_RATINGS': {
        const rated = new Set(ratings.filter((r) => r.stage === item.ratingStage).map((r) => r.projectContractorId));
        const done = contractors.filter((c) => rated.has(c.id)).length;
        out.set(item.key, {
          met: contractors.length > 0 && done === contractors.length,
          detail: `${done} of ${contractors.length} contractor(s) rated ${CONTRACTOR_RATING_STAGE_META[item.ratingStage].label.toLowerCase()}.`,
        });
        break;
      }
      case 'LESSONS_LEARNED':
        out.set(item.key, { met: lessons > 0, detail: lessons ? `${lessons} published lesson(s).` : 'No published lesson yet.' });
        break;
      default:
        out.set(item.key, { met: false, detail: null });
    }
  }
  return out;
}

type StateRow = Prisma.ClosureChecklistItemStateGetPayload<object>;

function effectiveStatus(state: StateRow | undefined, evaluation: Evaluation | undefined, automatic: boolean): ClosureChecklistItemStatus {
  if (state && state.status !== 'PENDING') return state.status;
  return automatic && evaluation?.met ? 'DONE' : 'PENDING';
}

/** Pending items of a list (missing state rows count as pending). */
async function pendingItems(db: Db, projectId: string, list: ClosureChecklistList) {
  const project = await snapshotOf(db, projectId);
  const templates = templatesOf(project.projectTypeSnapshotJson)[list];
  if (templates.length === 0) return { templates, pending: [] as ClosureChecklistItemTemplate[], generated: false };
  const [states, evaluation] = await Promise.all([
    db.closureChecklistItemState.findMany({ where: { projectId, list } }),
    evaluateItems(db, projectId, templates),
  ]);
  const byKey = new Map(states.map((s) => [s.itemKey, s]));
  const pending = templates.filter((t) => effectiveStatus(byKey.get(t.key), evaluation.get(t.key), AUTOMATIC_CLOSURE_ITEM_KINDS.includes(t.kind)) === 'PENDING');
  return { templates, pending, generated: states.length > 0 };
}

function pendingText(pending: ClosureChecklistItemTemplate[], what: string) {
  const names = pending.slice(0, 4).map((p) => `"${p.label}"`).join(', ');
  return `${pending.length} closure item(s) must be done or waived before ${what}: ${names}${pending.length > 4 ? ', …' : ''}.`;
}

/** Why the project cannot close yet (before-closing items), or null. */
export async function closeBlockedReason(db: Db, projectId: string): Promise<string | null> {
  const { pending } = await pendingItems(db, projectId, 'BEFORE_CLOSE');
  return pending.length ? pendingText(pending, 'the project can be closed') : null;
}

/**
 * Why the project cannot be archived yet (before-archiving items), or null. Applies once the
 * checklist exists (the project entered handover); a project abandoned earlier is not held.
 */
export async function archiveBlockedReason(db: Db, projectId: string): Promise<string | null> {
  const { pending, generated } = await pendingItems(db, projectId, 'BEFORE_ARCHIVE');
  const project = await snapshotOf(db, projectId);
  if (!generated && project.constructionPhase !== 'COMPLETED_CLOSED') return null;
  return pending.length ? pendingText(pending, 'the project can be archived') : null;
}

/** Stores DONE for automatic items that are met now (closing or archiving freezes them). */
export async function freezeMetAutomaticItems(tx: Tx, projectId: string, list: ClosureChecklistList, userId: string | null) {
  await ensureClosureChecklist(tx, projectId);
  const project = await snapshotOf(tx, projectId);
  const templates = templatesOf(project.projectTypeSnapshotJson)[list].filter((t) => AUTOMATIC_CLOSURE_ITEM_KINDS.includes(t.kind));
  if (!templates.length) return;
  const evaluation = await evaluateItems(tx, projectId, templates);
  const now = new Date();
  for (const t of templates) {
    const e = evaluation.get(t.key);
    if (!e?.met) continue;
    await tx.closureChecklistItemState.updateMany({
      where: { projectId, list, itemKey: t.key, status: 'PENDING' },
      data: { status: 'DONE', completedAt: now, completedByUserId: userId, notes: e.detail },
    });
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function managePermissionFor(t: ClosureChecklistItemTemplate) {
  if (t.kind === 'AUDIT_SIGNOFF') return 'closure:audit_signoff';
  return t.permissionKey || 'closure:manage_checklist';
}

/** GET /projects/:projectId/closure */
export async function getClosureChecklist(projectId: string, webUser: WebJwtPayload): Promise<ProjectClosureChecklistDto> {
  const project = await snapshotOf(prisma, projectId);
  // A project already past construction (e.g. before this phase shipped) gets its rows now.
  if (project.status === 'ACTIVE' && project.constructionPhase !== 'ACTIVE_CONSTRUCTION') {
    await prisma.$transaction((tx) => ensureClosureChecklist(tx, projectId));
  }
  const templates = templatesOf(project.projectTypeSnapshotJson);
  const states = await prisma.closureChecklistItemState.findMany({ where: { projectId } });
  const generated = states.length > 0;
  const evaluation = await evaluateItems(prisma, projectId, [...templates.BEFORE_CLOSE, ...templates.BEFORE_ARCHIVE]);
  const userIds = [...new Set(states.map((s) => s.completedByUserId).filter((v): v is string => Boolean(v)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
  const userName = new Map(users.map((u) => [u.id, u.fullName]));
  const canWaivePermission = hasWebPermission(webUser, 'closure:manage_checklist');

  const build = (list: ClosureChecklistList): ClosureChecklistItemDto[] =>
    templates[list].map((t) => {
      const state = states.find((s) => s.list === list && s.itemKey === t.key);
      const automatic = AUTOMATIC_CLOSURE_ITEM_KINDS.includes(t.kind);
      const e = evaluation.get(t.key);
      const status = effectiveStatus(state, e, automatic);
      const open = status === 'PENDING' && Boolean(state);
      return {
        id: state?.id ?? '00000000-0000-0000-0000-000000000000',
        list,
        key: t.key,
        label: t.label,
        description: t.description ?? CLOSURE_ITEM_KIND_META[t.kind].description,
        kind: t.kind,
        automatic,
        status,
        detail: e?.detail ?? null,
        completedByName: state?.completedByUserId ? userName.get(state.completedByUserId) ?? null : null,
        completedAt: state?.completedAt?.toISOString() ?? null,
        notes: state?.notes ?? null,
        waivedReason: state?.waivedReason ?? null,
        canComplete: open && !automatic && hasWebPermission(webUser, managePermissionFor(t)),
        canWaive: open && t.kind !== 'AUDIT_SIGNOFF' && canWaivePermission,
      };
    });
  const beforeClose = build('BEFORE_CLOSE');
  const beforeArchive = build('BEFORE_ARCHIVE');
  const count = (items: ClosureChecklistItemDto[]) => ({ done: items.filter((i) => i.status !== 'PENDING').length, total: items.length });
  return {
    projectId,
    phase: project.constructionPhase,
    status: project.status,
    generated,
    beforeClose,
    beforeArchive,
    progress: { beforeClose: count(beforeClose), beforeArchive: count(beforeArchive) },
    closeBlockedReason: beforeClose.some((i) => i.status === 'PENDING')
      ? pendingText(
          templates.BEFORE_CLOSE.filter((t) => beforeClose.find((i) => i.key === t.key)?.status === 'PENDING'),
          'the project can be closed'
        )
      : null,
    archiveBlockedReason: await archiveBlockedReason(prisma, projectId),
  };
}

// ---------------------------------------------------------------------------
// Ticking and waiving
// ---------------------------------------------------------------------------

async function loadItem(tx: Tx, projectId: string, list: ClosureChecklistList, key: string) {
  const project = await snapshotOf(tx, projectId);
  const template = templatesOf(project.projectTypeSnapshotJson)[list].find((t) => t.key === key);
  if (!template) throw new AppError('Closure item not found', 404, 'CLOSURE_ITEM_NOT_FOUND');
  const state = await tx.closureChecklistItemState.findUnique({ where: { projectId_list_itemKey: { projectId, list, itemKey: key } } });
  if (!state) throw new AppError('The closure checklist starts when the project enters handover.', 409, 'CLOSURE_CHECKLIST_NOT_STARTED');
  await tx.$queryRaw`SELECT id FROM "closure_checklist_items" WHERE id = ${state.id}::uuid FOR UPDATE`;
  const fresh = await tx.closureChecklistItemState.findUniqueOrThrow({ where: { id: state.id } });
  if (fresh.status !== 'PENDING') throw new AppError(`This item is already ${fresh.status.toLowerCase()}.`, 409, 'CLOSURE_ITEM_CLOSED');
  return { template, state: fresh };
}

/** POST /projects/:projectId/closure/:list/:itemKey/complete (manual and audit items) */
export async function completeClosureItem(projectId: string, list: ClosureChecklistList, key: string, webUser: WebJwtPayload, notes: string | null) {
  await prisma.$transaction(async (tx) => {
    const { template, state } = await loadItem(tx, projectId, list, key);
    if (AUTOMATIC_CLOSURE_ITEM_KINDS.includes(template.kind)) {
      throw new AppError('This item is checked by the platform. Do what it asks, or waive it with a reason.', 409, 'CLOSURE_ITEM_AUTOMATIC');
    }
    const permission = managePermissionFor(template);
    if (!hasWebPermission(webUser, permission)) throw new AppError(`This item needs ${permission}`, 403, 'FORBIDDEN_PERMISSION');
    await tx.closureChecklistItemState.update({
      where: { id: state.id },
      data: { status: 'DONE', completedAt: new Date(), completedByUserId: webUser.userId, notes },
    });
    const audit = template.kind === 'AUDIT_SIGNOFF';
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: audit ? 'CLOSURE_AUDIT_SIGNED' : 'CLOSURE_ITEM_COMPLETED',
      summaryText: `${audit ? 'Signed off' : 'Ticked'} closure item "${template.label}" (${list === 'BEFORE_CLOSE' ? 'before closing' : 'before archiving'})${notes ? `: ${notes}` : '.'}`,
      payload: { list, itemKey: key, kind: template.kind, notes },
    });
  });
  return getClosureChecklist(projectId, webUser);
}

/** POST /projects/:projectId/closure/:list/:itemKey/waive */
export async function waiveClosureItem(projectId: string, list: ClosureChecklistList, key: string, webUser: WebJwtPayload, reason: string) {
  await prisma.$transaction(async (tx) => {
    const { template, state } = await loadItem(tx, projectId, list, key);
    if (template.kind === 'AUDIT_SIGNOFF') throw new AppError('The audit sign-off cannot be waived.', 409, 'CLOSURE_AUDIT_NOT_WAIVABLE');
    await tx.closureChecklistItemState.update({
      where: { id: state.id },
      data: { status: 'WAIVED', waivedReason: reason, completedAt: new Date(), completedByUserId: webUser.userId },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'CLOSURE_ITEM_WAIVED',
      summaryText: `Waived closure item "${template.label}" (${list === 'BEFORE_CLOSE' ? 'before closing' : 'before archiving'}): ${reason}`,
      payload: { list, itemKey: key, kind: template.kind, reason },
    });
  });
  return getClosureChecklist(projectId, webUser);
}

export { LIST_FIELD };
