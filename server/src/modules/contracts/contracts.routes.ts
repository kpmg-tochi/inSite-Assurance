import { Router, Request, Response, NextFunction } from 'express';
import {
  ActOnDefaultCaseRequestSchema,
  CompleteMilestoneRequestSchema,
  RaiseDefaultCaseRequestSchema,
  RecordKickoffHeldRequestSchema,
  SaveKickoffMeetingRequestSchema,
  SendKickoffNoticeRequestSchema,
  WaiveMilestoneRequestSchema,
} from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requirePermission, requireWebAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { completeMilestone, getProjectMilestones, waiveMilestone } from './milestones.service';
import { getProjectKickoff, recordKickoffHeld, saveKickoffMeeting, sendKickoffNotice } from './kickoff.service';
import { getMobilisationCompliance } from './compliance.service';
import { actOnDefaultCase, getDefaultCase, listDefaultCases, raiseDefaultCase } from './defaultCases.service';

/**
 * Phase 13 project routes: contract milestones, kick-off meeting, mobilisation compliance, default
 * cases. Mounted at /api/v1/projects. (Redesign R2d: the programme of works is a document.)
 */
const router = guardProjectRoutes(Router());

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
const p = (req: Request, key: string) => String(req.params[key]);

// Milestones ------------------------------------------------------------------

router.get(
  '/:projectId/milestones',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await getProjectMilestones(p(req, 'projectId')) });
  })
);

router.post(
  '/:projectId/milestones/:milestoneId/complete',
  requirePermission('milestones:manage'),
  validateBody(CompleteMilestoneRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await completeMilestone(p(req, 'projectId'), p(req, 'milestoneId'), req.webUser!, req.body.notes ?? null) });
  })
);

router.post(
  '/:projectId/milestones/:milestoneId/waive',
  requirePermission('milestones:waive'),
  validateBody(WaiveMilestoneRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await waiveMilestone(p(req, 'projectId'), p(req, 'milestoneId'), req.webUser!, req.body.reason) });
  })
);

// Kick-off ----------------------------------------------------------------------

router.get(
  '/:projectId/kickoff',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await getProjectKickoff(p(req, 'projectId')) });
  })
);

router.put(
  '/:projectId/kickoff',
  requirePermission('kickoff:manage'),
  validateBody(SaveKickoffMeetingRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await saveKickoffMeeting(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.post(
  '/:projectId/kickoff/send-notice',
  requirePermission('kickoff:manage'),
  validateBody(SendKickoffNoticeRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await sendKickoffNotice(p(req, 'projectId'), req.webUser!, req.body.waiveLeadTimeReason) });
  })
);

router.post(
  '/:projectId/kickoff/held',
  requirePermission('kickoff:manage'),
  validateBody(RecordKickoffHeldRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await recordKickoffHeld(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

// Mobilisation compliance ---------------------------------------------------------

router.get(
  '/:projectId/mobilisation-compliance',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await getMobilisationCompliance(p(req, 'projectId')) });
  })
);

// Default cases ---------------------------------------------------------------------

router.get(
  '/:projectId/default-cases',
  requireWebAuth,
  wrap(async (req, res) => {
    const data = await listDefaultCases(p(req, 'projectId'), req.webUser!, {
      contractorId: typeof req.query.contractorId === 'string' ? req.query.contractorId : undefined,
      openOnly: req.query.openOnly === 'true',
    });
    res.json({ success: true, data });
  })
);

router.get(
  '/:projectId/default-cases/:caseId',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await getDefaultCase(p(req, 'projectId'), p(req, 'caseId'), req.webUser!) });
  })
);

router.post(
  '/:projectId/default-cases',
  requirePermission('contracts:raise_default'),
  validateBody(RaiseDefaultCaseRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await raiseDefaultCase(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

/** Permission per step is checked by the chain engine (gateForStep). */
router.post(
  '/:projectId/default-cases/:caseId/act',
  requireWebAuth,
  validateBody(ActOnDefaultCaseRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await actOnDefaultCase(p(req, 'projectId'), p(req, 'caseId'), req.webUser!, req.body) });
  })
);


export const contractsRoutes = router;
