import { useMutation } from '@tanstack/react-query';
import type { WebLoginRequest } from '@insite/shared';
import { loginUser } from '../../api/auth/authApi';

export const useLoginMutation = () => {
  return useMutation({
    mutationFn: (payload: WebLoginRequest) => loginUser(payload),
  });
};
