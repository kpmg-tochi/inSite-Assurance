import { useQuery } from '@tanstack/react-query';
import { getNeedsTaskCount, listNeedsTasks } from '../../api/needsDecisions';

/** Needs pipeline wave 3: the task queue ("Waiting for me", nav badge). Keys start with `needs`. */
export const needsTasksRootKey = ['needs', 'tasks'] as const;
export const needsTasksKey = (cycleId: string | null | undefined) => ['needs', 'tasks', 'list', cycleId ?? 'all'] as const;
export const needsTaskCountKey = ['needs', 'tasks', 'count'] as const;

/** How often the nav badge asks for the count (modest: the queue changes when people act). */
export const NEEDS_TASK_COUNT_POLL_MS = 60 * 1000;

export const useNeedsTasksQuery = (cycleId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: needsTasksKey(cycleId),
    queryFn: () => listNeedsTasks({ cycleId: cycleId ?? undefined }),
    enabled,
    staleTime: 30 * 1000,
    retry: 1,
  });

/** The nav badge: polled while the window is visible, only for holders of `needs:view`. */
export const useNeedsTaskCountQuery = (enabled: boolean) =>
  useQuery({
    queryKey: needsTaskCountKey,
    queryFn: getNeedsTaskCount,
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: enabled ? NEEDS_TASK_COUNT_POLL_MS : false,
    refetchIntervalInBackground: false,
    retry: 1,
  });
