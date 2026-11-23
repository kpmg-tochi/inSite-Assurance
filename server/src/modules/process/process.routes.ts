import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import {
  ApplyWorkflowTemplateRequestSchema,
  ApprovalChainTypeEnum,
  ProjectStandardInputSchema,
  RegisterNeedsAssessmentRequestSchema,
  ReplaceApprovalChainRequestSchema,
  SaveWorkflowTemplateRequestSchema,
  UpdateProjectProcessConfigRequestSchema,
  UpdateProjectStandardRequestSchema,
} from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requireAnyAuthWithWebPermission, requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { AppError } from '../../middleware/error.middleware';
import {
  applyTemplateToProject,
  getProjectProcessSettings,
  replaceProjectChain,
  updateProjectProcessConfig,
} from './processConfig.service';
import {
  createWorkflowTemplate,
  deleteWorkflowTemplate,
  listWorkflowTemplates,
  updateWorkflowTemplate,
} from './workflowTemplates.service';
import {
  createProjectStandard,
  deleteNeedsAssessment,
  deleteProjectStandard,
  listNeedsAssessments,
  listProjectStandards,
  registerNeedsAssessment,
  updateProjectStandard,
} from '../standards/standards.service';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap =
  (fn: Handler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
const p = (req: Request, name: string) => String(req.params[name]);

// ---------------------------------------------------------------------------
// Tenant workflow templates: /api/v1/workflow-templates
// ---------------------------------------------------------------------------

export const workflowTemplateRoutes = Router();

/** Any web user who sets up projects can read templates (the wizard picker). */
workflowTemplateRoutes.get(
  '/',
  requirePermission('templates:manage_workflows', 'projects:create', 'projects:edit_baseline'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listWorkflowTemplates(req.webUser!.tenantId) });
  })
);

workflowTemplateRoutes.post(
  '/',
  requirePermission('templates:manage_workflows'),
  validateBody(SaveWorkflowTemplateRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await createWorkflowTemplate(req.webUser!, req.body) });
  })
);

workflowTemplateRoutes.put(
  '/:templateId',
  requirePermission('templates:manage_workflows'),
  validateBody(SaveWorkflowTemplateRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await updateWorkflowTemplate(req.webUser!, p(req, 'templateId'), req.body) });
  })
);

workflowTemplateRoutes.delete(
  '/:templateId',
  requirePermission('templates:manage_workflows'),
  wrap(async (req, res) => {
    await deleteWorkflowTemplate(req.webUser!, p(req, 'templateId'));
    res.json({ success: true, data: { deleted: true } });
  })
);

// ---------------------------------------------------------------------------
// Project process, standards and needs assessments: /api/v1/projects/:projectId/...
// ---------------------------------------------------------------------------

const router = guardProjectRoutes(Router());

router.get(
  '/:projectId/process',
  requirePermission('projects:view_assigned', 'projects:view_all_tenant', 'projects:edit_baseline', 'projects:create'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getProjectProcessSettings(p(req, 'projectId')) });
  })
);

router.put(
  '/:projectId/process',
  requirePermission('projects:edit_baseline'),
  validateBody(UpdateProjectProcessConfigRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await updateProjectProcessConfig(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.put(
  '/:projectId/process/chains/:chainType',
  requirePermission('projects:edit_baseline'),
  validateBody(ReplaceApprovalChainRequestSchema),
  wrap(async (req, res) => {
    const chainType = ApprovalChainTypeEnum.safeParse(p(req, 'chainType'));
    if (!chainType.success) throw new AppError('Unknown chain type', 404, 'CHAIN_TYPE_NOT_FOUND');
    res.json({
      success: true,
      data: await replaceProjectChain(p(req, 'projectId'), chainType.data, req.webUser!, req.body.steps),
    });
  })
);

router.post(
  '/:projectId/process/apply-template',
  requirePermission('projects:edit_baseline', 'projects:create'),
  validateBody(ApplyWorkflowTemplateRequestSchema),
  wrap(async (req, res) => {
    res.json({
      success: true,
      data: await applyTemplateToProject(
        p(req, 'projectId'),
        req.body.templateId,
        req.webUser!,
        req.body.confirmDeactivateContractorCodes === true
      ),
    });
  })
);

// Standards are read by field users too (briefs show them); writes need manage_standards_docs.
router.get(
  '/:projectId/standards',
  requireAnyAuthWithWebPermission('boq:view', 'projects:manage_standards_docs'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listProjectStandards(p(req, 'projectId')) });
  })
);

router.post(
  '/:projectId/standards',
  requirePermission('projects:manage_standards_docs'),
  validateBody(ProjectStandardInputSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await createProjectStandard(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.patch(
  '/:projectId/standards/:standardId',
  requirePermission('projects:manage_standards_docs'),
  validateBody(UpdateProjectStandardRequestSchema),
  wrap(async (req, res) => {
    res.json({
      success: true,
      data: await updateProjectStandard(p(req, 'projectId'), p(req, 'standardId'), req.webUser!, req.body),
    });
  })
);

router.delete(
  '/:projectId/standards/:standardId',
  requirePermission('projects:manage_standards_docs'),
  wrap(async (req, res) => {
    await deleteProjectStandard(p(req, 'projectId'), p(req, 'standardId'), req.webUser!);
    res.json({ success: true, data: { deleted: true } });
  })
);

router.get(
  '/:projectId/needs-assessments',
  requirePermission('projects:manage_standards_docs', 'projects:view_assigned', 'projects:view_all_tenant'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listNeedsAssessments(p(req, 'projectId')) });
  })
);

router.post(
  '/:projectId/needs-assessments',
  requirePermission('projects:manage_standards_docs'),
  validateBody(RegisterNeedsAssessmentRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await registerNeedsAssessment(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.delete(
  '/:projectId/needs-assessments/:documentId',
  requirePermission('projects:manage_standards_docs'),
  wrap(async (req, res) => {
    await deleteNeedsAssessment(p(req, 'projectId'), p(req, 'documentId'), req.webUser!);
    res.json({ success: true, data: { deleted: true } });
  })
);

export const processRoutes = router;
