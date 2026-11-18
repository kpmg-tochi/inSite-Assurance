import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import {
  CertifyIpcValuationRequestSchema,
  CreateMonitorQueryRequestSchema,
  LenderTrancheDecisionRequestSchema,
  ResolveMonitorQueryRequestSchema,
  RespondMonitorQueryRequestSchema,
  ReverseTrancheDecisionRequestSchema,
  SubmitIpcClaimRequestSchema,
  UpdateConditionPrecedentStatusRequestSchema,
  WaiveConditionPrecedentRequestSchema,
  WithdrawIpcClaimRequestSchema,
} from '@insite/shared';
import { requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  certifyIpcValuationByMonitor,
  createMonitorLineQuery,
  generateIpcValuationPdf,
  getIpcReconciliationDetails,
  listProjectIpcClaims,
  recordLenderTrancheDecision,
  rerunReconciliation,
  resolveMonitorLineQuery,
  respondToMonitorLineQuery,
  reverseTrancheDecision,
  submitContractorIpcClaim,
  updateConditionPrecedentStatus,
  waiveConditionPrecedent,
  withdrawIpcClaim,
} from './reconciliation.service';

const router = guardProjectRoutes(Router());

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap =
  (fn: Handler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

const p = (req: Request, name: string) => String(req.params[name]);

/** GET /api/v1/projects/:projectId/ipcs */
router.get(
  '/:projectId/ipcs',
  requirePermission('ipc:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listProjectIpcClaims(p(req, 'projectId'), req.webUser!) });
  })
);

/**
 * POST /api/v1/projects/:projectId/ipcs
 * 201 once the claim is saved. If reconciliation could not run, `data.reconciliationPending` is
 * true and the claim stays SUBMITTED for a retry through /reconcile.
 */
router.post(
  '/:projectId/ipcs',
  requirePermission('ipc:submit_claim'),
  validateBody(SubmitIpcClaimRequestSchema),
  wrap(async (req, res) => {
    const created = await submitContractorIpcClaim({
      projectId: p(req, 'projectId'),
      webUser: req.webUser!,
      input: req.body,
    });
    res.status(201).json({ success: true, data: created });
  })
);

/** GET /api/v1/projects/:projectId/ipcs/:ipcId */
router.get(
  '/:projectId/ipcs/:ipcId',
  requirePermission('ipc:view'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      data: await getIpcReconciliationDetails(p(req, 'projectId'), p(req, 'ipcId'), req.webUser!),
    });
  })
);

/** POST /api/v1/projects/:projectId/ipcs/:ipcId/reconcile */
router.post(
  '/:projectId/ipcs/:ipcId/reconcile',
  requirePermission('ipc:trigger_ai_reconcile'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      data: await rerunReconciliation(p(req, 'projectId'), p(req, 'ipcId'), req.webUser!),
    });
  })
);

/** POST /api/v1/projects/:projectId/ipcs/:ipcId/withdraw */
router.post(
  '/:projectId/ipcs/:ipcId/withdraw',
  requirePermission('ipc:submit_claim'),
  validateBody(WithdrawIpcClaimRequestSchema),
  wrap(async (req, res) => {
    const data = await withdrawIpcClaim({
      projectId: p(req, 'projectId'),
      ipcId: p(req, 'ipcId'),
      webUser: req.webUser!,
      input: req.body,
    });
    res.json({ success: true, data });
  })
);

/** POST /api/v1/projects/:projectId/ipcs/:ipcId/queries */
router.post(
  '/:projectId/ipcs/:ipcId/queries',
  requirePermission('reports:raise_query'),
  validateBody(CreateMonitorQueryRequestSchema),
  wrap(async (req, res) => {
    const query = await createMonitorLineQuery({
      projectId: p(req, 'projectId'),
      ipcId: p(req, 'ipcId'),
      webUser: req.webUser!,
      input: req.body,
    });
    res.status(201).json({ success: true, data: query });
  })
);

/** PATCH /api/v1/projects/:projectId/ipcs/:ipcId/queries/:queryId/respond */
router.patch(
  '/:projectId/ipcs/:ipcId/queries/:queryId/respond',
  requirePermission('reports:respond_query'),
  validateBody(RespondMonitorQueryRequestSchema),
  wrap(async (req, res) => {
    const updated = await respondToMonitorLineQuery({
      projectId: p(req, 'projectId'),
      ipcId: p(req, 'ipcId'),
      queryId: p(req, 'queryId'),
      webUser: req.webUser!,
      input: req.body,
    });
    res.json({ success: true, data: updated });
  })
);

/** POST /api/v1/projects/:projectId/ipcs/:ipcId/queries/:queryId/resolve */
router.post(
  '/:projectId/ipcs/:ipcId/queries/:queryId/resolve',
  requirePermission('reports:raise_query'),
  validateBody(ResolveMonitorQueryRequestSchema),
  wrap(async (req, res) => {
    const result = await resolveMonitorLineQuery({
      projectId: p(req, 'projectId'),
      ipcId: p(req, 'ipcId'),
      queryId: p(req, 'queryId'),
      webUser: req.webUser!,
      input: req.body,
    });
    res.json({ success: true, data: result });
  })
);

/**
 * POST /api/v1/projects/:projectId/ipcs/:ipcId/certify
 * With `?dryRun=true` returns the server-computed figures without saving anything.
 */
router.post(
  '/:projectId/ipcs/:ipcId/certify',
  requirePermission('ipc:certify_valuation'),
  validateBody(CertifyIpcValuationRequestSchema),
  wrap(async (req, res) => {
    const result = await certifyIpcValuationByMonitor({
      projectId: p(req, 'projectId'),
      ipcId: p(req, 'ipcId'),
      webUser: req.webUser!,
      input: req.body,
      dryRun: req.query.dryRun === 'true',
    });
    res.json({ success: true, data: result });
  })
);

/** GET /api/v1/projects/:projectId/ipcs/:ipcId/valuation-report.pdf */
router.get(
  '/:projectId/ipcs/:ipcId/valuation-report.pdf',
  requirePermission('valuation:export_pdf'),
  wrap(async (req, res) => {
    const pdfBuffer = await generateIpcValuationPdf(p(req, 'projectId'), p(req, 'ipcId'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Valuation-Report-${p(req, 'ipcId')}.pdf"`
    );
    res.send(pdfBuffer);
  })
);

/** POST /api/v1/projects/:projectId/tranches/:trancheId/decision */
router.post(
  '/:projectId/tranches/:trancheId/decision',
  requirePermission('tranche:approve_disbursement'),
  validateBody(LenderTrancheDecisionRequestSchema),
  wrap(async (req, res) => {
    const decision = await recordLenderTrancheDecision({
      projectId: p(req, 'projectId'),
      trancheId: p(req, 'trancheId'),
      webUser: req.webUser!,
      input: req.body,
    });
    res.json({ success: true, data: decision });
  })
);

/** POST /api/v1/projects/:projectId/tranche-decisions/:decisionId/reverse */
router.post(
  '/:projectId/tranche-decisions/:decisionId/reverse',
  requirePermission('tranche:approve_disbursement'),
  validateBody(ReverseTrancheDecisionRequestSchema),
  wrap(async (req, res) => {
    const reversal = await reverseTrancheDecision({
      projectId: p(req, 'projectId'),
      decisionId: p(req, 'decisionId'),
      webUser: req.webUser!,
      input: req.body,
    });
    res.status(201).json({ success: true, data: reversal });
  })
);

/** PATCH /api/v1/projects/:projectId/tranches/:trancheId/conditions/:conditionId/status */
router.patch(
  '/:projectId/tranches/:trancheId/conditions/:conditionId/status',
  requirePermission('tranche:approve_disbursement', 'ipc:certify_valuation'),
  validateBody(UpdateConditionPrecedentStatusRequestSchema),
  wrap(async (req, res) => {
    const tranche = await updateConditionPrecedentStatus({
      projectId: p(req, 'projectId'),
      trancheId: p(req, 'trancheId'),
      conditionId: p(req, 'conditionId'),
      webUser: req.webUser!,
      input: req.body,
    });
    res.json({ success: true, data: tranche });
  })
);

/** POST /api/v1/projects/:projectId/tranches/:trancheId/conditions/:conditionId/waive */
router.post(
  '/:projectId/tranches/:trancheId/conditions/:conditionId/waive',
  requirePermission('tranche:approve_disbursement'),
  validateBody(WaiveConditionPrecedentRequestSchema),
  wrap(async (req, res) => {
    const tranche = await waiveConditionPrecedent({
      projectId: p(req, 'projectId'),
      trancheId: p(req, 'trancheId'),
      conditionId: p(req, 'conditionId'),
      webUser: req.webUser!,
      input: req.body,
    });
    res.json({ success: true, data: tranche });
  })
);

export const reconciliationRoutes = router;
