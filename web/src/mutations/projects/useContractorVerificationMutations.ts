import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ReviewContractorVerificationRequest } from '@insite/shared';
import { reviewContractorVerification } from '../../api/projects/contractorVerificationApi';

export interface ReviewContractorParams {
  projectId: string;
  sessionId: string;
  payload: ReviewContractorVerificationRequest;
}

export const useReviewContractorVerificationMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, sessionId, payload }: ReviewContractorParams) =>
      reviewContractorVerification(projectId, sessionId, payload),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['contractor-verifications', variables.projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ['contractor-verifications'],
      });
      queryClient.invalidateQueries({
        queryKey: ['portfolio-executive-summary'],
      });
      queryClient.invalidateQueries({
        queryKey: ['audit-trail', variables.projectId],
      });

      if (variables.payload.decision === 'APPROVE') {
        toast.success(
          `Contractor assurance approved for ${data.agentFullName}. Field capture access granted.`
        );
      } else {
        toast.info(
          `Contractor assurance rejected for ${data.agentFullName}. Submission archived.`
        );
      }
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        'Failed to record contractor verification decision.';
      toast.error(msg);
    },
  });
};

