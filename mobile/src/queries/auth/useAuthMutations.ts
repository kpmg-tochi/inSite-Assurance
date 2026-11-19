import { useMutation } from '@tanstack/react-query';
import type {
  DemoSkipVerificationRequest,
  JoinProjectMobileRequest,
} from '@insite/shared';
import {
  demoSkipVerification,
  joinProjectByCode,
} from '../../api/auth/authApi';

export function useJoinProjectMutation() {
  return useMutation({
    mutationFn: (payload: JoinProjectMobileRequest) => joinProjectByCode(payload),
  });
}

export function useDemoSkipVerificationMutation() {
  return useMutation({
    mutationFn: ({ payload, existingJoinToken }: { payload: DemoSkipVerificationRequest; existingJoinToken?: string }) =>
      demoSkipVerification(payload, existingJoinToken),
  });
}

