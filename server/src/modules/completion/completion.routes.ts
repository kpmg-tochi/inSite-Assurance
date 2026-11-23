import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import {
  ClosureChecklistList,
  CompleteClosureItemRequestSchema,
  DraftCompletionCertificateRequestSchema,
  RateContractorRequestSchema,
  RecordBeneficiarySignatureRequestSchema,
  RevokeCompletionCertificateRequestSchema,
  SaveLessonRequestSchema,
  SaveRatingCriteriaRequestSchema,
  SignCompletionCertificateRequestSchema,
  UpdateCompletionCertificateRequestSchema,
  WaiveClosureItemRequestSchema,
} from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requirePermission, requireWebAuth } from '../../middleware/auth.middleware';
import { AppError } from '../../middleware/error.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  completionCertificatePdf,
  draftCompletionCertificate,
  getProjectCompletion,
  recordBeneficiarySignature,
  revokeCompletionCertificate,
  signCompletionCertificate,
  updateCompletionCertificate,
} from './completion.service';
import { completeClosureItem, getClosureChecklist, waiveClosureItem } from './closure.service';
import { getOrganizationRatings, getProjectRatings, getRatingCriteria, rateContractor, saveRatingCriteria } from './ratings.service';
import { createLesson, listLessonLibrary, listProjectLessons, publishLesson, updateLesson } from './lessons.service';
import { listClosurePacks, requestClosurePack } from './closurePack.service';

/** Phase 15 project routes (mounted at /api/v1/projects; the project guard applies). */
const router = guardProjectRoutes(Router());

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
const p = (req: Request, name: string) => String(req.params[name]);

// Certificate of Completion -------------------------------------------------

router.get(
  '/:projectId/completion',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await getProjectCompletion(p(req, 'projectId'), req.webUser!) });
  })
);

router.post(
  '/:projectId/completion/certificate',
  requirePermission('completion:draft_certificate'),
  validateBody(DraftCompletionCertificateRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await draftCompletionCertificate(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.put(
  '/:projectId/completion/certificate',
  requirePermission('completion:draft_certificate'),
  validateBody(UpdateCompletionCertificateRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await updateCompletionCertificate(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

/** Permission, role and organisation come from the slot (checked by the service). */
router.post(
  '/:projectId/completion/certificate/sign',
  requireWebAuth,
  validateBody(SignCompletionCertificateRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await signCompletionCertificate(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.post(
  '/:projectId/completion/certificate/beneficiary',
  requirePermission('completion:draft_certificate'),
  validateBody(RecordBeneficiarySignatureRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await recordBeneficiarySignature(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.post(
  '/:projectId/completion/certificate/revoke',
  requirePermission('completion:revoke_certificate'),
  validateBody(RevokeCompletionCertificateRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await revokeCompletionCertificate(p(req, 'projectId'), req.webUser!, req.body.reason) });
  })
);

router.get(
  '/:projectId/completion/certificate/pdf',
  requireWebAuth,
  wrap(async (req, res) => {
    const pdf = await completionCertificatePdf(p(req, 'projectId'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdf.fileName}"`);
    res.send(pdf.body);
  })
);

// Closure checklist ------------------------------------------------------------

const LIST_PARAM: Record<string, ClosureChecklistList> = { 'before-close': 'BEFORE_CLOSE', 'before-archive': 'BEFORE_ARCHIVE' };
function listOf(req: Request): ClosureChecklistList {
  const list = LIST_PARAM[p(req, 'list')];
  if (!list) throw new AppError('Closure list not found', 404, 'CLOSURE_LIST_NOT_FOUND');
  return list;
}

router.get(
  '/:projectId/closure',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await getClosureChecklist(p(req, 'projectId'), req.webUser!) });
  })
);

/** Manual items need closure:manage_checklist (or the item's permission); audit items closure:audit_signoff. */
router.post(
  '/:projectId/closure/:list/:itemKey/complete',
  requireWebAuth,
  validateBody(CompleteClosureItemRequestSchema),
  wrap(async (req, res) => {
    res.json({
      success: true,
      data: await completeClosureItem(p(req, 'projectId'), listOf(req), p(req, 'itemKey'), req.webUser!, req.body.notes ?? null),
    });
  })
);

router.post(
  '/:projectId/closure/:list/:itemKey/waive',
  requirePermission('closure:manage_checklist'),
  validateBody(WaiveClosureItemRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await waiveClosureItem(p(req, 'projectId'), listOf(req), p(req, 'itemKey'), req.webUser!, req.body.reason) });
  })
);

// Contractor ratings -------------------------------------------------------------

router.get(
  '/:projectId/contractor-ratings',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await getProjectRatings(p(req, 'projectId'), req.webUser!) });
  })
);

router.post(
  '/:projectId/contractor-ratings',
  requirePermission('contractors:rate_performance'),
  validateBody(RateContractorRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await rateContractor(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

// Lessons learned -----------------------------------------------------------------

router.get(
  '/:projectId/lessons',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await listProjectLessons(p(req, 'projectId'), req.webUser!) });
  })
);

router.post(
  '/:projectId/lessons',
  requirePermission('lessons:manage'),
  validateBody(SaveLessonRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await createLesson(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.put(
  '/:projectId/lessons/:lessonId',
  requirePermission('lessons:manage'),
  validateBody(SaveLessonRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await updateLesson(p(req, 'projectId'), p(req, 'lessonId'), req.webUser!, req.body) });
  })
);

router.post(
  '/:projectId/lessons/:lessonId/publish',
  requirePermission('lessons:manage'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await publishLesson(p(req, 'projectId'), p(req, 'lessonId'), req.webUser!) });
  })
);

// Closure pack ----------------------------------------------------------------------

router.get(
  '/:projectId/closure-pack',
  requirePermission('closure:export_pack'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listClosurePacks(p(req, 'projectId')) });
  })
);

router.post(
  '/:projectId/closure-pack',
  requirePermission('closure:export_pack'),
  wrap(async (req, res) => {
    res.status(202).json({ success: true, data: await requestClosurePack(p(req, 'projectId'), req.webUser!) });
  })
);

export { router as completionRoutes };

// Tenant routes (mounted at /api/v1/closure) ----------------------------------------

const tenantRouter = Router();

tenantRouter.get(
  '/lessons',
  requirePermission('lessons:view'),
  wrap(async (req, res) => {
    const q = req.query;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    res.json({
      success: true,
      data: await listLessonLibrary(req.webUser!, {
        projectTypeId: str(q.projectTypeId),
        regionId: str(q.regionId),
        category: str(q.category),
        tag: str(q.tag),
        q: str(q.q),
      }),
    });
  })
);

tenantRouter.get(
  '/organizations/:organizationId/ratings',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await getOrganizationRatings(p(req, 'organizationId'), req.webUser!) });
  })
);

tenantRouter.get(
  '/rating-criteria',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await getRatingCriteria(req.webUser!.tenantId) });
  })
);

tenantRouter.put(
  '/rating-criteria',
  requirePermission('tenant:manage_settings'),
  validateBody(SaveRatingCriteriaRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await saveRatingCriteria(req.webUser!, req.body) });
  })
);

export { tenantRouter as closureTenantRoutes };
