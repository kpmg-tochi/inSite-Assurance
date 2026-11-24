import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CreateFacilityUnitRequest,
  CreateScopeLineRequest,
  ProjectScopeDto,
  SaveSprintsRequest,
  ScopeImportConfirmRequest,
  ScopeImportPreviewRequest,
  UpdateFacilityUnitRequest,
  UpdateScopeLineRequest,
} from '@insite/shared';
import {
  createFacilityUnit,
  createScopeLine,
  deleteFacilityUnit,
  deleteScopeLine,
  saveSprints,
  confirmScopeImport,
  downloadScopeWorkbook,
  downloadTenantScopeWorkbook,
  previewScopeImport,
  updateFacilityUnit,
  updateScopeLine,
} from '../../api/scope/scopeApi';
import { projectScopeKey } from '../../queries/scope/useScopeQueries';
import { projectSetupKey } from '../../queries/projects/useProjectSetupQueries';
import { facilitiesKey } from '../../queries/facilities/useFacilityQueries';

const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

/** Every scope write returns the new scope; the setup status and facility counts follow it. */
function settle(qc: QueryClient, projectId: string, scope: ProjectScopeDto) {
  qc.setQueryData(projectScopeKey(projectId), scope);
  qc.invalidateQueries({ queryKey: projectSetupKey(projectId) });
  qc.invalidateQueries({ queryKey: facilitiesKey });
  qc.invalidateQueries({ queryKey: ['project-drafts'] });
}

function useScopeMutation<V>(projectId: string, fn: (v: V) => Promise<ProjectScopeDto>, success: string, failure: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (scope) => {
      settle(qc, projectId, scope);
      toast.success(success);
    },
    onError: (err) => toast.error(errorMessage(err, failure)),
  });
}

export const useSaveSprintsMutation = (projectId: string) =>
  useScopeMutation(projectId, (body: SaveSprintsRequest) => saveSprints(projectId, body), 'Sprints saved.', 'Could not save the sprints.');

export const useSaveFacilityUnitMutation = (projectId: string) =>
  useScopeMutation(
    projectId,
    (p: { id?: string; create?: CreateFacilityUnitRequest; update?: UpdateFacilityUnitRequest }) =>
      p.id ? updateFacilityUnit(projectId, p.id, p.update ?? {}) : createFacilityUnit(projectId, p.create!),
    'Facility unit saved.',
    'Could not save the facility unit.'
  );

export const useDeleteFacilityUnitMutation = (projectId: string) =>
  useScopeMutation(projectId, (unitId: string) => deleteFacilityUnit(projectId, unitId), 'Facility unit removed.', 'Could not remove the unit.');

export const useSaveScopeLineMutation = (projectId: string) =>
  useScopeMutation(
    projectId,
    (p: { id?: string; create?: CreateScopeLineRequest; update?: UpdateScopeLineRequest }) =>
      p.id ? updateScopeLine(projectId, p.id, p.update ?? {}) : createScopeLine(projectId, p.create!),
    'BoQ line saved.',
    'Could not save the BoQ line.'
  );

export const useDeleteScopeLineMutation = (projectId: string) =>
  useScopeMutation(projectId, (lineId: string) => deleteScopeLine(projectId, lineId), 'BoQ line removed.', 'Could not remove the line.');

// Redesign R2c: the needs-assessment workbook.

/** Saves the workbook file in the browser. */
function saveFile({ blob, fileName }: { blob: Blob; fileName: string }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The project's workbook, pre-filled with its scope and project details. */
export const useDownloadScopeWorkbookMutation = (projectId: string) =>
  useMutation({
    mutationFn: () => downloadScopeWorkbook(projectId),
    onSuccess: saveFile,
    onError: (err) => toast.error(errorMessage(err, 'Could not download the workbook.')),
  });

/** A blank workbook with the workspace's lists (Settings). */
export const useDownloadTenantScopeWorkbookMutation = () =>
  useMutation({
    mutationFn: () => downloadTenantScopeWorkbook(),
    onSuccess: saveFile,
    onError: (err) => toast.error(errorMessage(err, 'Could not download the workbook.')),
  });

/** Parses the file on the server; nothing is saved. */
export const usePreviewScopeImportMutation = (projectId: string) =>
  useMutation({
    mutationFn: (body: ScopeImportPreviewRequest) => previewScopeImport(projectId, body),
    onError: (err) => toast.error(errorMessage(err, 'Could not read the workbook.')),
  });

/** Replaces the draft's scope with the previewed workbook. */
export const useConfirmScopeImportMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ScopeImportConfirmRequest) => confirmScopeImport(projectId, body),
    onSuccess: (result) => {
      settle(qc, projectId, result.scope);
      toast.success(
        `Workbook imported: ${result.scope.totals.lineCount} BoQ line(s) on ${result.scope.totals.unitCount} facility unit(s).` +
          (result.filledProjectFields.length ? ' Empty project fields were filled from the Project sheet.' : '')
      );
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not import the workbook.')),
  });
};
