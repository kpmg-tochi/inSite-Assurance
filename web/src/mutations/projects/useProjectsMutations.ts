import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateProjectRequest } from '@insite/shared';
import { createProject } from '../../api/projects/projectsApi';

export const useCreateProjectMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateProjectRequest) => createProject(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
};

