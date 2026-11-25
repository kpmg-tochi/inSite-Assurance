import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ClosureChecklistList,
  DraftCompletionCertificateRequest,
  ProjectCompletionDto,
  RateContractorRequest,
  RatingCriterion,
  SaveLessonRequestInput,
  UpdateCompletionCertificateRequest,
} from '@insite/shared';
import {
  completeClosureItem,
  createLesson,
  draftCompletionCertificate,
  fetchCompletionCertificatePdf,
  publishLesson,
  rateContractor,
  recordBeneficiarySignature,
  requestClosurePack,
  revokeCompletionCertificate,
  saveRatingCriteria,
  signCompletionCertificate,
  updateCompletionCertificate,
  updateLesson,
  waiveClosureItem,
} from '../../api/closure/closureApi';
import { uploadProjectDocumentFile } from '../../api/contracts/contractsApi';
import { projectDocumentsKey, milestonesKey } from '../../queries/contracts/useContractQueries';
import {
  closureChecklistKey,
  closurePacksKey,
  completionKey,
  lessonLibraryKey,
  projectLessonsKey,
  projectRatingsKey,
  ratingCriteriaKey,
} from '../../queries/closure/useClosureQueries';

/** Mutation hooks own their toasts; pages must not toast again. */
const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

/** Everything a certificate change can move: phase gates, milestones, the register, the checklist. */
function afterCompletionChange(qc: QueryClient, projectId: string, data: ProjectCompletionDto) {
  qc.setQueryData(completionKey(projectId), data);
  qc.invalidateQueries({ queryKey: ['project-phase', projectId] });
  qc.invalidateQueries({ queryKey: milestonesKey(projectId) });
  qc.invalidateQueries({ queryKey: projectDocumentsKey(projectId) });
  qc.invalidateQueries({ queryKey: closureChecklistKey(projectId) });
  qc.invalidateQueries({ queryKey: ['projects'] });
}

export const useDraftCertificateMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DraftCompletionCertificateRequest) => draftCompletionCertificate(projectId, body),
    onSuccess: (data) => {
      afterCompletionChange(qc, projectId, data);
      toast.success(`Certificate ${data.certificate?.certificateNumber ?? ''} drafted. Collect the signatures.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not draft the certificate.')),
  });
};

export const useUpdateCertificateMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateCompletionCertificateRequest) => updateCompletionCertificate(projectId, body),
    onSuccess: (data) => {
      afterCompletionChange(qc, projectId, data);
      toast.success('Certificate draft saved.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the draft.')),
  });
};

export const useSignCertificateMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slotKey: string) => signCompletionCertificate(projectId, { slotKey }),
    onSuccess: (data) => {
      afterCompletionChange(qc, projectId, data);
      toast.success(data.certificate?.status === 'ISSUED' ? 'Signed. Every slot is signed: the certificate is issued.' : 'Signed.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not sign the certificate.')),
  });
};

/** Uploads the beneficiary's signed paper copy, then records the signature with the attestation. */
export const useRecordBeneficiaryMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { slotKey: string; beneficiaryName: string; beneficiaryRole: string; file: File; onProgress?: (f: number) => void }) => {
      const objectKey = await uploadProjectDocumentFile(projectId, p.file, p.onProgress);
      return recordBeneficiarySignature(projectId, {
        slotKey: p.slotKey,
        beneficiaryName: p.beneficiaryName,
        beneficiaryRole: p.beneficiaryRole,
        objectKey,
        attest: true,
      });
    },
    onSuccess: (data) => {
      afterCompletionChange(qc, projectId, data);
      toast.success(data.certificate?.status === 'ISSUED' ? 'Beneficiary signature recorded: the certificate is issued.' : 'Beneficiary signature recorded.');
    },
    onError: (err) => toast.error(errorMessage(err, "Could not record the beneficiary's signature.")),
  });
};

export const useRevokeCertificateMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => revokeCompletionCertificate(projectId, reason),
    onSuccess: (data) => {
      afterCompletionChange(qc, projectId, data);
      toast.success('Certificate revoked.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not revoke the certificate.')),
  });
};

/** Opens the certificate PDF in a new tab (opened first so it is not treated as a pop-up). */
export const useOpenCertificatePdfMutation = (projectId: string) =>
  useMutation({
    mutationFn: async () => {
      const tab = window.open('', '_blank');
      try {
        const url = await fetchCompletionCertificatePdf(projectId);
        if (tab) tab.location.href = url;
        else window.location.assign(url);
      } catch (err) {
        tab?.close();
        throw err;
      }
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not open the certificate.')),
  });

// Closure checklist ---------------------------------------------------------------------

export const useCompleteClosureItemMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { list: ClosureChecklistList; itemKey: string; notes: string | null }) => completeClosureItem(projectId, p.list, p.itemKey, p.notes),
    onSuccess: (data) => {
      qc.setQueryData(closureChecklistKey(projectId), data);
      qc.invalidateQueries({ queryKey: ['project-phase', projectId] });
      toast.success('Closure item done.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not complete the item.')),
  });
};

export const useWaiveClosureItemMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { list: ClosureChecklistList; itemKey: string; reason: string }) => waiveClosureItem(projectId, p.list, p.itemKey, p.reason),
    onSuccess: (data) => {
      qc.setQueryData(closureChecklistKey(projectId), data);
      qc.invalidateQueries({ queryKey: ['project-phase', projectId] });
      toast.success('Closure item waived.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not waive the item.')),
  });
};

// Ratings and lessons -------------------------------------------------------------------

export const useRateContractorMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RateContractorRequest) => rateContractor(projectId, body),
    onSuccess: (data) => {
      qc.setQueryData(projectRatingsKey(projectId), data);
      qc.invalidateQueries({ queryKey: closureChecklistKey(projectId) });
      qc.invalidateQueries({ queryKey: ['organization-ratings'] });
      toast.success('Rating recorded.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not record the rating.')),
  });
};

export const useSaveLessonMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { lessonId?: string; body: SaveLessonRequestInput }) =>
      p.lessonId ? updateLesson(projectId, p.lessonId, p.body) : createLesson(projectId, p.body),
    onSuccess: (_d, p) => {
      qc.invalidateQueries({ queryKey: projectLessonsKey(projectId) });
      qc.invalidateQueries({ queryKey: lessonLibraryKey });
      toast.success(p.lessonId ? 'Lesson saved.' : 'Lesson saved as a draft.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the lesson.')),
  });
};

export const usePublishLessonMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) => publishLesson(projectId, lessonId),
    onSuccess: (lesson) => {
      qc.invalidateQueries({ queryKey: projectLessonsKey(projectId) });
      qc.invalidateQueries({ queryKey: lessonLibraryKey });
      qc.invalidateQueries({ queryKey: closureChecklistKey(projectId) });
      toast.success(lesson.sharedWithContractor ? 'Lesson published and shared with the contractor.' : 'Lesson published to the library.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not publish the lesson.')),
  });
};

export const useSaveRatingCriteriaMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (criteria: RatingCriterion[]) => saveRatingCriteria(criteria),
    onSuccess: (data) => {
      qc.setQueryData(ratingCriteriaKey, data);
      toast.success('Rating criteria saved.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the criteria.')),
  });
};

// Closure pack ----------------------------------------------------------------------------

export const useRequestClosurePackMutation = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => requestClosurePack(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: closurePacksKey(projectId) });
      toast.success('Project closure file queued. It appears here when it is ready.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not start the project closure file.')),
  });
};
