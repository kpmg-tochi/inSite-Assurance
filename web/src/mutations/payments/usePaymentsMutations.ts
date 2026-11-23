import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PAYMENT_KIND_LABELS, type RecordPaymentRequest, type VoidPaymentRequest } from '@insite/shared';
import { recordPayment, voidPayment } from '../../api/payments/paymentsApi';
import { projectPaymentsKey } from '../../queries/payments/usePaymentsQueries';
import { retentionSummaryKey } from '../../queries/closeout/useCloseoutQueries';

/** Mutation hooks own their toasts; pages must not toast again. */
const errorMessage = (err: unknown, fallback: string) => (err as { message?: string })?.message || fallback;

function invalidatePayments(queryClient: QueryClient, projectId: string) {
  queryClient.invalidateQueries({ queryKey: projectPaymentsKey(projectId) });
  queryClient.invalidateQueries({ queryKey: retentionSummaryKey(projectId) });
  queryClient.invalidateQueries({ queryKey: ['projects'] });
  queryClient.invalidateQueries({ queryKey: ['web-notifications'] });
}

export const useRecordPaymentMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordPaymentRequest) => recordPayment(projectId, body),
    onSuccess: (payment) => {
      invalidatePayments(queryClient, projectId);
      if (payment.exceptions.length > 0) {
        toast.warning(`${PAYMENT_KIND_LABELS[payment.kind]} recorded with ${payment.exceptions.length} exception(s).`);
      } else {
        toast.success(`${PAYMENT_KIND_LABELS[payment.kind]} recorded.`);
      }
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not record the payment.')),
  });
};

export const useVoidPaymentMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { paymentId: string; body: VoidPaymentRequest }) => voidPayment(projectId, args.paymentId, args.body),
    onSuccess: (payment) => {
      invalidatePayments(queryClient, projectId);
      toast.success(`Payment ${payment.reference} voided.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not void the payment.')),
  });
};
