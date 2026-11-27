import { NextFunction, Request, Response, Router } from 'express';
import {
  CommitteeScoringRequestSchema,
  ConflictDeclarationRequestSchema,
  FinaliseRankingRequestSchema,
  NeedsDocumentPresignRequestSchema,
  RankingPlacementRequestSchema,
  RegisterCycleDocumentRequestSchema,
  ScoreSheetSchema,
  SetCommitteeRequestSchema,
  SetFundingLineRequestSchema,
} from '@insite/shared';
import { requirePermission } from '../../../middleware/auth.middleware';
import { validateBody } from '../../../middleware/validate.middleware';
import { changeScoring, declareConflicts, getCommittee, presignMinutes, registerMinutes, setCommittee } from './needsCommittee.service';
import { finaliseRanking, getRanking, regeneratePrioritisedPortfolio, setFundingLine, setPlacement } from './needsRanking.service';
import { getMyScoring, getProposalScores, saveScoreSheet } from './needsScoreSheets.service';

/**
 * Needs pipeline wave 3, Track B (N5): committee, scoring and ranking under /api/v1/needs (mounted
 * in app.ts before `needsRoutes`). Routes: parent plan section 17.9. Web users only; `needs:view`
 * to read. Writes also need the cycle's owning organisation and an OPEN cycle; the chair's writes
 * need the caller to be the committee's CHAIR row (403 NEEDS_NOT_COMMITTEE_CHAIR).
 */
export const needsCommitteeRoutes = Router();

const param = (req: Request, name: string): string => String(req.params[name] ?? '');

const send =
  (fn: (req: Request) => Promise<unknown>, status = 200) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((data) => res.status(status).json({ success: true, data }))
      .catch(next);
  };

const VIEW = requirePermission('needs:view');
const CHAIR = requirePermission('needs:chair_committee');
const MEMBER = requirePermission('needs:score', 'needs:chair_committee');
const SCORE = requirePermission('needs:score');

// Committee (B1).
needsCommitteeRoutes.get('/cycles/:cycleId/committee', VIEW, send((req) => getCommittee(req.webUser!, param(req, 'cycleId'))));
needsCommitteeRoutes.put('/cycles/:cycleId/committee', CHAIR, validateBody(SetCommitteeRequestSchema), send((req) => setCommittee(req.webUser!, param(req, 'cycleId'), req.body)));
needsCommitteeRoutes.post(
  '/cycles/:cycleId/committee/declaration',
  MEMBER,
  validateBody(ConflictDeclarationRequestSchema),
  send((req) => declareConflicts(req.webUser!, param(req, 'cycleId'), req.body))
);
needsCommitteeRoutes.post(
  '/cycles/:cycleId/committee/scoring',
  CHAIR,
  validateBody(CommitteeScoringRequestSchema),
  send((req) => changeScoring(req.webUser!, param(req, 'cycleId'), req.body))
);
needsCommitteeRoutes.post(
  '/cycles/:cycleId/committee/minutes/presign',
  CHAIR,
  validateBody(NeedsDocumentPresignRequestSchema),
  send((req) => presignMinutes(req.webUser!, param(req, 'cycleId'), req.body))
);
needsCommitteeRoutes.post(
  '/cycles/:cycleId/committee/minutes',
  CHAIR,
  validateBody(RegisterCycleDocumentRequestSchema),
  send((req) => registerMinutes(req.webUser!, param(req, 'cycleId'), req.body), 201)
);

// Score sheets (B2).
needsCommitteeRoutes.get('/cycles/:cycleId/score-sheets/mine', VIEW, send((req) => getMyScoring(req.webUser!, param(req, 'cycleId'))));
needsCommitteeRoutes.put('/cycles/:cycleId/score-sheets', SCORE, validateBody(ScoreSheetSchema), send((req) => saveScoreSheet(req.webUser!, param(req, 'cycleId'), req.body)));
needsCommitteeRoutes.get('/proposals/:proposalId/scores', VIEW, send((req) => getProposalScores(req.webUser!, param(req, 'proposalId'))));

// Ranking (B3, B4).
needsCommitteeRoutes.get('/cycles/:cycleId/ranking', VIEW, send((req) => getRanking(req.webUser!, param(req, 'cycleId'))));
needsCommitteeRoutes.post(
  '/cycles/:cycleId/ranking/placements',
  CHAIR,
  validateBody(RankingPlacementRequestSchema),
  send((req) => setPlacement(req.webUser!, param(req, 'cycleId'), req.body))
);
needsCommitteeRoutes.put(
  '/cycles/:cycleId/ranking/line',
  CHAIR,
  validateBody(SetFundingLineRequestSchema),
  send((req) => setFundingLine(req.webUser!, param(req, 'cycleId'), req.body))
);
needsCommitteeRoutes.post(
  '/cycles/:cycleId/ranking/finalise',
  CHAIR,
  validateBody(FinaliseRankingRequestSchema),
  send((req) => finaliseRanking(req.webUser!, param(req, 'cycleId'), req.body))
);
needsCommitteeRoutes.post('/cycles/:cycleId/ranking/report', CHAIR, send((req) => regeneratePrioritisedPortfolio(req.webUser!, param(req, 'cycleId')), 201));
