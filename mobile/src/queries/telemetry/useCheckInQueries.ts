import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getTodayCheckIn } from '../../api/telemetry/telemetryApi';
import { recordManualCheckIn } from '../../services/telemetryService';

export const checkInQueryKey = (projectId: string | null | undefined) => ['check-in-today', projectId] as const;

/** Today's check-in as the server evaluated it. Null offline (the app never guesses a result). */
export function useTodayCheckInQuery(projectId: string | null | undefined) {
  return useQuery({
    queryKey: checkInQueryKey(projectId),
    queryFn: () => getTodayCheckIn(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: 5 * 60_000,
  });
}

/** Records a signed MANUAL_CHECKIN ping, then re-reads the server's result after the outbox sends it. */
export function useManualCheckInMutation(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => recordManualCheckIn(projectId!),
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: checkInQueryKey(projectId) }), 3_000);
    },
  });
}
