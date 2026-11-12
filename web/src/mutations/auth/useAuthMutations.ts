import { useMutation } from '@tanstack/react-query';
import type { WebLoginRequest, WebRegisterRequest } from '@insite/shared';
import { loginUser, registerUser } from '../../api/auth/authApi';

export const useLoginMutation = () => {
  return useMutation({
    mutationFn: (payload: WebLoginRequest) => loginUser(payload),
  });
};

export const useRegisterMutation = () => {
  return useMutation({
    mutationFn: (payload: WebRegisterRequest) => registerUser(payload),
  });
};

