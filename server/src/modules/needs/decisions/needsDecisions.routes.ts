import { NextFunction, Request, Response, Router } from 'express';
import {
  NeedsTaskListQuerySchema,
  ProposalBatchActionRequestSchema,
  RecordValidationRequestSchema,
  ResolveProposalFlagsRequestSchema,
  SeparationOverrideDecisionRequestSchema,
  SeparationOverrideRequestSchema,
  StageDecisionRequestSchema,
} from '@insite/shared';
import { requirePermission } from '../../../middleware/auth.middleware';
import { validateBody } from '../../../middleware/validate.middleware';
import { regenerateStageReport } from '../reports/needsReports.service';
import { applyProposalActions, decideStage } from './needsDecisions.service';
import { decideSeparationOverride, requestSeparationOverride } from './needsOverrides.service';
import { countTasks, listTasks } from './needsTasks.service';
import { recordValidation, resolveProposalFlags } from './needsValidation.service';

/**
 * Needs pipeline wave 3, Track A (N4): stage work under /api/v1/needs (mounted in app.ts before
 * `needsRoutes`). Routes: parent plan section 17.9. Web users only (`requirePermission`); the
 * services check the cycle's owning organisation, the open cycle and the specific permission of each
 * step.
 */
export const needsDecisionsRoutes = Router();

const param = (req: Request, name: string): string => String(req.params[name] ?? '');

type Handler = (req: Request) => Promise<unknown>;
const send =
  (fn: Handler, status = 200) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((data) => res.status(status).json({ success: true, data }))
      .catch(next);
  };

const VIEW = requirePermission('needs:view');
const STAGE_WORKERS = requirePermission('needs:submit', 'needs:validate', 'needs:cost');
const DECIDERS = requirePermission('needs:validate', 'needs:cost', 'needs:chair_committee');
const FLAG_RESOLVERS = requirePermission('needs:validate', 'needs:cost');
const OVERRIDE_ASKERS = requirePermission('needs:validate', 'needs:cost');
const OVERRIDE_DECIDERS = requirePermission('needs:override_separation');
const REPORTERS = requirePermission('needs:validate', 'needs:cost', 'needs:manage_cycle');

// Task queue (static paths).
needsDecisionsRoutes.get('/tasks', VIEW, send((req) => listTasks(req.webUser!, NeedsTaskListQuerySchema.parse(req.query))));
needsDecisionsRoutes.get('/tasks/count', VIEW, send((req) => countTasks(req.webUser!)));

// Batch actions and stage decisions (D-N.4).
needsDecisionsRoutes.post(
  '/cycles/:cycleId/proposal-actions',
  STAGE_WORKERS,
  validateBody(ProposalBatchActionRequestSchema),
  send((req) => applyProposalActions(req.webUser!, param(req, 'cycleId'), req.body))
);
needsDecisionsRoutes.post(
  '/cycles/:cycleId/decisions',
  DECIDERS,
  validateBody(StageDecisionRequestSchema),
  send((req) => decideStage(req.webUser!, param(req, 'cycleId'), req.body), 201)
);

// Separation-of-duties overrides (16.2 O-1).
needsDecisionsRoutes.post(
  '/cycles/:cycleId/separation-overrides',
  OVERRIDE_ASKERS,
  validateBody(SeparationOverrideRequestSchema),
  send((req) => requestSeparationOverride(req.webUser!, param(req, 'cycleId'), req.body), 201)
);
needsDecisionsRoutes.post(
  '/cycles/:cycleId/separation-overrides/:flagId/decision',
  OVERRIDE_DECIDERS,
  validateBody(SeparationOverrideDecisionRequestSchema),
  send((req) => decideSeparationOverride(req.webUser!, param(req, 'cycleId'), param(req, 'flagId'), req.body))
);

// Generated cycle reports (Validated Project List, Cost Estimate Report).
needsDecisionsRoutes.post('/cycles/:cycleId/reports/:kind', REPORTERS, send((req) => regenerateStageReport(req.webUser!, param(req, 'cycleId'), param(req, 'kind')), 201));

// Validation records and flag resolutions.
needsDecisionsRoutes.post(
  '/proposals/:proposalId/validation',
  requirePermission('needs:validate'),
  validateBody(RecordValidationRequestSchema),
  send((req) => recordValidation(req.webUser!, param(req, 'proposalId'), req.body), 201)
);
needsDecisionsRoutes.post(
  '/proposals/:proposalId/flags/resolve',
  FLAG_RESOLVERS,
  validateBody(ResolveProposalFlagsRequestSchema),
  send((req) => resolveProposalFlags(req.webUser!, param(req, 'proposalId'), req.body))
);
