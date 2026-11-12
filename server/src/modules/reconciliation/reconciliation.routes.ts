import { Router, Request, Response, NextFunction } from 'express';
import {
  CertifyIpcValuationRequestSchema,
  CreateMonitorQueryRequestSchema,
  LenderTrancheDecisionRequestSchema,
  RespondMonitorQueryRequestSchema,
  SubmitIpcClaimRequestSchema,
} from '@insite/shared';
import {
  requireRole,
  requireWebAuth,
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

const router = Router();

/**
 * GET /api/v1/projects/:projectId/ipcs
 * Lists all IPC claims for a project.
 */
router.get(
  '/:projectId/ipcs',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ipcs = await listProjectIpcClaims(String(req.params.projectId));
      res.json({ success: true, data: ipcs });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/ipcs
 * Contractor submits an Interim Payment Certificate (IPC) claim -> automatically triggers AI Reconciliation.
 */
router.post(
  '/:projectId/ipcs',
  requireRole('CONTRACTOR', 'MONITOR'),
  validateBody(SubmitIpcClaimRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await submitContractorIpcClaim({
        projectId: String(req.params.projectId),
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
 * Returns Claim-vs-Evidence Reconciliation Queue + Smart Visit Planner.
 */
router.get(
  '/:projectId/ipcs/:ipcId',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const details = await getIpcReconciliationDetails(
        String(req.params.projectId),
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
 * Monitor triggers or re-triggers AI Evidence Strength Rating reconciliation.
 */
router.post(
  '/:projectId/ipcs/:ipcId/reconcile',
  requireRole('MONITOR'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await runAiReconciliationForIpc(
        String(req.params.projectId),
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
 * Monitor raises a dispute query on an IPC line item.
 */
router.post(
  '/:projectId/ipcs/:ipcId/queries',
  requireRole('MONITOR'),
  validateBody(CreateMonitorQueryRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = await createMonitorLineQuery({
        projectId: String(req.params.projectId),
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
 * Contractor responds to a Monitor query with clarification and optional revised claim %.
 */
router.patch(
  '/:projectId/ipcs/:ipcId/queries/:queryId/respond',
  requireRole('CONTRACTOR', 'MONITOR'),
  validateBody(RespondMonitorQueryRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await respondToMonitorLineQuery({
        projectId: String(req.params.projectId),
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
 * Licensed Monitor (QSRBN / COREN) certifies line-item valuations and signs off the Valuation Report.
 */
router.post(
  '/:projectId/ipcs/:ipcId/certify',
  requireRole('MONITOR'),
  validateBody(CertifyIpcValuationRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await certifyIpcValuationByMonitor({
        projectId: String(req.params.projectId),
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
 * Generates and streams the executive Disbursement Evidence & Valuation Report PDF.
 */
router.get(
  '/:projectId/ipcs/:ipcId/valuation-report.pdf',
  requireRole('MONITOR', 'LENDER'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pdfBuffer = await generateIpcValuationPdf(
        String(req.params.projectId),
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
 * Lender / Guarantor records formal tranche disbursement decision (APPROVE_FULL, APPROVE_WITH_HOLDBACK, HOLD).
 */
router.post(
  '/:projectId/tranches/:trancheId/decision',
  requireRole('LENDER'),
  validateBody(LenderTrancheDecisionRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const decision = await recordLenderTrancheDecision({
        projectId: String(req.params.projectId),
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

