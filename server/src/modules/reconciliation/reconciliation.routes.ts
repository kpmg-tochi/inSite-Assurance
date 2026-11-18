import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import {
  CertifyIpcValuationRequestSchema,
  CreateMonitorQueryRequestSchema,
  LenderTrancheDecisionRequestSchema,
  RespondMonitorQueryRequestSchema,
  SubmitIpcClaimRequestSchema,
} from '@insite/shared';
import {
  requirePermission,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  certifyIpcValuationByMonitor,
  createMonitorLineQuery,
  generateIpcValuationPdf,
  getIpcReconciliationDetails,
  listProjectIpcClaims,
  recordLenderTrancheDecision,
  respondToMonitorLineQuery,
  runAiReconciliationForIpc,
  submitContractorIpcClaim,
} from './reconciliation.service';

const router = guardProjectRoutes(Router());

/**
 * GET /api/v1/projects/:projectId/ipcs
 */
router.get(
  '/:projectId/ipcs',
  requirePermission('ipc:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const ipcs = await listProjectIpcClaims(projectId, req.webUser!);
      res.json({ success: true, data: ipcs });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/ipcs
 */
router.post(
  '/:projectId/ipcs',
  requirePermission('ipc:submit_claim'),
  validateBody(SubmitIpcClaimRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const created = await submitContractorIpcClaim({
        projectId,
        webUser: req.webUser!,
        input: req.body,
      });
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/ipcs/:ipcId
 */
router.get(
  '/:projectId/ipcs/:ipcId',
  requirePermission('ipc:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const details = await getIpcReconciliationDetails(
        projectId,
        String(req.params.ipcId),
        req.webUser!
      );
      res.json({ success: true, data: details });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/ipcs/:ipcId/reconcile
 */
router.post(
  '/:projectId/ipcs/:ipcId/reconcile',
  requirePermission('ipc:trigger_ai_reconcile'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const updated = await runAiReconciliationForIpc(
        projectId,
        String(req.params.ipcId)
      );
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/ipcs/:ipcId/queries
 */
router.post(
  '/:projectId/ipcs/:ipcId/queries',
  requirePermission('reports:raise_query'),
  validateBody(CreateMonitorQueryRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const query = await createMonitorLineQuery({
        projectId,
        ipcId: String(req.params.ipcId),
        webUser: req.webUser!,
        input: req.body,
      });
      res.status(201).json({ success: true, data: query });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/v1/projects/:projectId/ipcs/:ipcId/queries/:queryId/respond
 */
router.patch(
  '/:projectId/ipcs/:ipcId/queries/:queryId/respond',
  requirePermission('reports:respond_query'),
  validateBody(RespondMonitorQueryRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const updated = await respondToMonitorLineQuery({
        projectId,
        ipcId: String(req.params.ipcId),
        queryId: String(req.params.queryId),
        webUser: req.webUser!,
        input: req.body,
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/ipcs/:ipcId/certify
 */
router.post(
  '/:projectId/ipcs/:ipcId/certify',
  requirePermission('ipc:certify_valuation'),
  validateBody(CertifyIpcValuationRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const report = await certifyIpcValuationByMonitor({
        projectId,
        ipcId: String(req.params.ipcId),
        webUser: req.webUser!,
        input: req.body,
      });
      res.json({ success: true, data: report });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/ipcs/:ipcId/valuation-report.pdf
 */
router.get(
  '/:projectId/ipcs/:ipcId/valuation-report.pdf',
  requirePermission('valuation:export_pdf'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const pdfBuffer = await generateIpcValuationPdf(
        projectId,
        String(req.params.ipcId)
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="Valuation-Report-${req.params.ipcId}.pdf"`
      );
      res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/tranches/:trancheId/decision
 */
router.post(
  '/:projectId/tranches/:trancheId/decision',
  requirePermission('tranche:approve_disbursement'),
  validateBody(LenderTrancheDecisionRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const decision = await recordLenderTrancheDecision({
        projectId,
        trancheId: String(req.params.trancheId),
        webUser: req.webUser!,
        input: req.body,
      });
      res.json({ success: true, data: decision });
    } catch (error) {
      next(error);
    }
  }
);

export const reconciliationRoutes = router;
