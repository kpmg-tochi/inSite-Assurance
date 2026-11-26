import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatProjectCode, type NeedsAssessmentConfirmRequest, type NeedsAssessmentPreviewRequest } from '@insite/shared';
import {
  apiErrorOf,
  confirmNeedsAssessment,
  NEEDS_ASSESSMENT_INPUT_REQUIRED,
  NOT_NEEDS_ASSESSMENT_TEMPLATE,
  previewNeedsAssessment,
} from '../api/needsAssessment';
import { projectLotsKey } from '../queries/projectLots';

const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

/** Error codes the dialog shows next to its fields instead of a toast. */
const INLINE_CONFIRM_CODES = new Set([NEEDS_ASSESSMENT_INPUT_REQUIRED, 'INTERVENTION_YEAR_NOT_ALLOWED', 'LOT_NOT_FOUND']);

/** Reads the file on the server; nothing is saved. A file that is not the template is shown inline. */
export const usePreviewNeedsAssessmentMutation = () =>
  useMutation({
    mutationFn: (body: NeedsAssessmentPreviewRequest) => previewNeedsAssessment(body),
    onError: (err) => {
      if (apiErrorOf(err).code === NOT_NEEDS_ASSESSMENT_TEMPLATE) return;
      toast.error(errorMessage(err, 'Could not read the needs assessment.'));
    },
  });

/** Creates the draft from the previewed needs assessment. */
export const useConfirmNeedsAssessmentMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: NeedsAssessmentConfirmRequest) => confirmNeedsAssessment(body),
    onSuccess: (result) => {
      // The lot's project count and next batch (or a new lot) changed; a draft was added.
      void queryClient.invalidateQueries({ queryKey: projectLotsKey });
      void queryClient.invalidateQueries({ queryKey: ['project-drafts'] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success(`Draft created from the needs assessment: ${formatProjectCode(result.codePrefix)}`);
    },
    onError: (err) => {
      const code = apiErrorOf(err).code;
      if (code && INLINE_CONFIRM_CODES.has(code)) return;
      toast.error(errorMessage(err, 'Could not create the project from the needs assessment.'));
    },
  });
};
