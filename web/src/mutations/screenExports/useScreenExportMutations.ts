import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { FindingsExportQuery, KpiQuery, PaymentsExportQuery, PlannerVisitsExportQuery, ProjectVisitsExportQuery } from '@insite/shared';
import {
  exportKpis,
  exportPlannerVisits,
  exportProjectFindings,
  exportProjectPayments,
  exportProjectVisits,
  type DownloadedFile,
} from '../../api/screenExports/screenExportsApi';

/** UBEC IRL: "Export to Excel" on the visits, findings, payments and KPI screens. */

const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

/** Saves the downloaded file in the browser. */
function saveFile({ blob, fileName }: DownloadedFile) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const useXlsxExport = <Q>(fetcher: (query: Q) => Promise<DownloadedFile>, what: string) =>
  useMutation({
    mutationFn: fetcher,
    onSuccess: (file) => {
      saveFile(file);
      toast.success(`Downloaded ${file.fileName}`);
    },
    onError: (err) => toast.error(errorMessage(err, `Could not export the ${what}.`)),
  });

export const useExportProjectVisitsMutation = (projectId: string) =>
  useXlsxExport((q: ProjectVisitsExportQuery) => exportProjectVisits(projectId, q), 'visits');

export const useExportPlannerVisitsMutation = () => useXlsxExport((q: PlannerVisitsExportQuery) => exportPlannerVisits(q), 'visits');

export const useExportProjectFindingsMutation = (projectId: string) =>
  useXlsxExport((q: FindingsExportQuery) => exportProjectFindings(projectId, q), 'findings');

export const useExportProjectPaymentsMutation = (projectId: string) =>
  useXlsxExport((q: PaymentsExportQuery) => exportProjectPayments(projectId, q), 'payments');

export const useExportKpisMutation = () => useXlsxExport((q: Partial<KpiQuery>) => exportKpis(q), 'KPIs');
