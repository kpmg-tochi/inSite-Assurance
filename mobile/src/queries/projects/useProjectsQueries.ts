import { useMutation } from '@tanstack/react-query';
import { resetDemoDatabase } from '../../api/projects/projectsApi';

export function useResetDemoMutation() {
  return useMutation({
    mutationFn: resetDemoDatabase,
  });
}
