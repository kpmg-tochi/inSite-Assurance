import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateProjectRequest } from '@insite/shared';
import { createProject } from '../../api/projects/projectsApi';

export const useCreateProjectMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateProjectRequest) => createProject(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success(
        `Project "${data.name}" initialized with 3 mobile join codes.`
      );
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to create project.');
    },
  });
};

