import { Router, Request, Response, NextFunction } from 'express';
import {
  CustomiseFacilitySubFormRequestSchema,
  FacilityArchetypeEnum,
  SaveFacilitySubFormRequestSchema,
  SaveFormSectionRequestSchema,
  SaveVisitFormTemplateRequestSchema,
  SetFormComponentArchivedRequestSchema,
} from '@insite/shared';
import { requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { AppError } from '../../middleware/error.middleware';
import {
  customiseFacilitySubForm,
  getFormLibrary,
  listSectionVersions,
  listSubFormVersions,
  listTemplateVersions,
  resetFacilitySubForm,
  saveArchetypeSubForm,
  saveFacilitySubForm,
  saveFormSection,
  saveVisitFormTemplate,
  setFormSectionArchived,
  setVisitFormTemplateArchived,
} from './formLibrary.service';

/** Redesign R3b: the tenant form library (mounted at /api/v1/form-library). */
const router = Router();

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const code = (req: Request) => String(req.params.code).toUpperCase();
const MANAGE = requirePermission('forms:manage');

/** Latest of every component, usage counts and each facility's effective sub-form (pickers read it too). */
router.get(
  '/',
  requirePermission('forms:manage', 'project_types:manage'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getFormLibrary(req.webUser!.tenantId) });
  })
);

router.get(
  '/sections/:code/versions',
  MANAGE,
  wrap(async (req, res) => {
    res.json({ success: true, data: await listSectionVersions(req.webUser!.tenantId, code(req)) });
  })
);
router.get(
  '/subforms/:subjectKey/versions',
  MANAGE,
  wrap(async (req, res) => {
    res.json({ success: true, data: await listSubFormVersions(req.webUser!.tenantId, String(req.params.subjectKey)) });
  })
);
router.get(
  '/templates/:code/versions',
  MANAGE,
  wrap(async (req, res) => {
    res.json({ success: true, data: await listTemplateVersions(req.webUser!.tenantId, code(req)) });
  })
);

// Fixed sections
router.post(
  '/sections',
  MANAGE,
  validateBody(SaveFormSectionRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await saveFormSection(req.webUser!, req.body, null) });
  })
);
router.put(
  '/sections/:code',
  MANAGE,
  validateBody(SaveFormSectionRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await saveFormSection(req.webUser!, req.body, code(req)) });
  })
);
router.patch(
  '/sections/:code',
  MANAGE,
  validateBody(SetFormComponentArchivedRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await setFormSectionArchived(req.webUser!, code(req), req.body.archived) });
  })
);

// Facility sub-forms
router.put(
  '/subforms/archetype/:archetype',
  MANAGE,
  validateBody(SaveFacilitySubFormRequestSchema),
  wrap(async (req, res) => {
    const archetype = FacilityArchetypeEnum.safeParse(String(req.params.archetype).toUpperCase());
    if (!archetype.success) throw new AppError('Unknown archetype', 404, 'SUBFORM_NOT_FOUND');
    res.json({ success: true, data: await saveArchetypeSubForm(req.webUser!, archetype.data, req.body) });
  })
);
router.post(
  '/subforms/facility/:facilityId',
  MANAGE,
  validateBody(CustomiseFacilitySubFormRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await customiseFacilitySubForm(req.webUser!, String(req.params.facilityId), req.body) });
  })
);
router.put(
  '/subforms/facility/:facilityId',
  MANAGE,
  validateBody(SaveFacilitySubFormRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await saveFacilitySubForm(req.webUser!, String(req.params.facilityId), req.body) });
  })
);
router.post(
  '/subforms/facility/:facilityId/reset',
  MANAGE,
  wrap(async (req, res) => {
    res.json({ success: true, data: await resetFacilitySubForm(req.webUser!, String(req.params.facilityId)) });
  })
);

// Visit form templates
router.post(
  '/templates',
  MANAGE,
  validateBody(SaveVisitFormTemplateRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await saveVisitFormTemplate(req.webUser!, req.body, null) });
  })
);
router.put(
  '/templates/:code',
  MANAGE,
  validateBody(SaveVisitFormTemplateRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await saveVisitFormTemplate(req.webUser!, req.body, code(req)) });
  })
);
router.patch(
  '/templates/:code',
  MANAGE,
  validateBody(SetFormComponentArchivedRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await setVisitFormTemplateArchived(req.webUser!, code(req), req.body.archived) });
  })
);

export const formLibraryRoutes = router;
