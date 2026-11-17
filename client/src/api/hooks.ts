import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Achievement,
  AiRun,
  Challenge,
  ChallengeInput,
  Stats,
  Streak,
  AiStatus,
  Dashboard,
  Group,
  GroupInput,
  Health,
  Miniature,
  MiniatureInput,
  MiniatureList,
  CatalogEntry,
  Paint,
  PaintBulkResult,
  PaintInput,
  PaintingSession,
  Photo,
  PhotoPatch,
  Recipe,
  RecipeInput,
  ShoppingItem,
  Status,
  StatusChangeResult,
  Tag,
} from '@minibald/shared';
import { api } from './client.ts';
import { prepareImage } from '../lib/image.ts';

export interface MiniFilters {
  q?: string;
  status?: string;
  group?: string;
  tag?: string;
  sort?: string;
}

const qs = (params: object) => {
  const entries = Object.entries(params).filter(([, v]) => v).map(([k, v]) => [k, String(v)]);
  return entries.length > 0 ? `?${new URLSearchParams(entries)}` : '';
};

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard') });
export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/health') });
export const useGroups = () => useQuery({ queryKey: ['groups'], queryFn: () => api<Group[]>('/groups') });
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: () => api<Tag[]>('/tags') });

export const useMiniatures = (filters: MiniFilters) =>
  useQuery({
    queryKey: ['miniatures', filters],
    queryFn: () => api<MiniatureList>(`/miniatures${qs(filters)}`),
    placeholderData: (prev) => prev,
  });

export const useMiniature = (id: number | undefined) =>
  useQuery({ queryKey: ['miniature', id], queryFn: () => api<Miniature>(`/miniatures/${id}`), enabled: id !== undefined });

/**
 * One user, small data: after any write we simply refetch whatever is on screen
 * instead of maintaining per-mutation cache updates.
 */
function useWrite<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries() });
}

export const useSaveGroup = () =>
  useWrite(({ id, ...input }: Partial<GroupInput> & { id?: number }) =>
    id ? api<Group>(`/groups/${id}`, { method: 'PATCH', json: input }) : api<Group>('/groups', { method: 'POST', json: input }),
  );
export const useDeleteGroup = () => useWrite((id: number) => api<void>(`/groups/${id}`, { method: 'DELETE' }));

export const useSaveMiniature = () =>
  useWrite(({ id, ...input }: Partial<MiniatureInput> & { id?: number }) =>
    id
      ? api<Miniature>(`/miniatures/${id}`, { method: 'PATCH', json: input })
      : api<Miniature>('/miniatures', { method: 'POST', json: input }),
  );
export const useDeleteMiniature = () => useWrite((id: number) => api<void>(`/miniatures/${id}`, { method: 'DELETE' }));
export const useSetStatus = (id: number) =>
  useWrite((status: Status) => api<StatusChangeResult>(`/miniatures/${id}/status`, { method: 'POST', json: { status } }));
export const useSetCover = (id: number) =>
  useWrite((photoId: number | null) => api<Miniature>(`/miniatures/${id}/cover`, { method: 'PUT', json: { photoId } }));

export const useUpdatePhoto = () =>
  useWrite(({ id, ...patch }: PhotoPatch & { id: number }) => api<Photo>(`/photos/${id}`, { method: 'PATCH', json: patch }));
export const useDeletePhoto = () => useWrite((id: number) => api<void>(`/photos/${id}`, { method: 'DELETE' }));

/** Resizes in the browser, then uploads one file per request so progress is visible on slow Wi-Fi. */
export function useUploadPhotos(miniatureId: number, onProgress: (done: number, total: number) => void) {
  return useWrite(async (files: File[]) => {
    onProgress(0, files.length);
    for (const [i, file] of files.entries()) {
      const { blob, takenAt } = await prepareImage(file);
      const form = new FormData();
      form.append('file', blob, 'photo.jpg');
      await api<Photo[]>(`/miniatures/${miniatureId}/photos${qs({ takenAt })}`, { method: 'POST', body: form });
      onProgress(i + 1, files.length);
    }
  });
}

// ---------- Paints and shopping list ----------
// The whole inventory is loaded once and filtered in the browser: it is a few hundred rows at most.
export const usePaints = () => useQuery({ queryKey: ['paints'], queryFn: () => api<Paint[]>('/paints') });
export const useSavePaint = () =>
  useWrite(({ id, ...input }: Partial<PaintInput> & { id?: number }) =>
    id ? api<Paint>(`/paints/${id}`, { method: 'PATCH', json: input }) : api<Paint>('/paints', { method: 'POST', json: input }),
  );
export const useCatalog = () => useQuery({ queryKey: ['catalog'], queryFn: () => api<CatalogEntry[]>('/catalog'), staleTime: 60_000 });
export const useAddPaints = () =>
  useWrite((items: PaintInput[]) => api<PaintBulkResult>('/paints/bulk', { method: 'POST', json: { items } }));
export const useDeletePaint = () => useWrite((id: number) => api<void>(`/paints/${id}`, { method: 'DELETE' }));

export const useShopping = () => useQuery({ queryKey: ['shopping'], queryFn: () => api<ShoppingItem[]>('/shopping') });
export const useAddShopping = () =>
  useWrite((items: { paintId?: number; label?: string }[]) =>
    Promise.all(items.map((item) => api<ShoppingItem>('/shopping', { method: 'POST', json: item }))),
  );
export const useUpdateShopping = () =>
  useWrite(({ id, ...patch }: { id: number; bought?: boolean; note?: string }) =>
    api<ShoppingItem>(`/shopping/${id}`, { method: 'PATCH', json: patch }),
  );
export const useDeleteShopping = () =>
  useWrite((id: number | 'bought') => api<void>(`/shopping/${id}`, { method: 'DELETE' }));

// ---------- Recipes ----------
/** A miniature's recipes, or the reusable library when no id is given. */
export const useRecipes = (miniatureId?: number) =>
  useQuery({
    queryKey: ['recipes', miniatureId ?? 'library'],
    queryFn: () => api<Recipe[]>(`/recipes${qs({ miniature: miniatureId })}`),
  });
export const useSaveRecipe = () =>
  useWrite(({ id, ...input }: Partial<RecipeInput> & { id?: number }) =>
    id ? api<Recipe>(`/recipes/${id}`, { method: 'PATCH', json: input }) : api<Recipe>('/recipes', { method: 'POST', json: input }),
  );
export const useDeleteRecipe = () => useWrite((id: number) => api<void>(`/recipes/${id}`, { method: 'DELETE' }));
export const useDuplicateRecipe = () =>
  useWrite(({ id, ...target }: { id: number; miniatureId: number | null; name?: string }) =>
    api<Recipe>(`/recipes/${id}/duplicate`, { method: 'POST', json: target }),
  );
export const useToggleStep = () =>
  useWrite(({ id, done }: { id: number; done: boolean }) => api<Recipe>(`/recipe-steps/${id}`, { method: 'PATCH', json: { done } }));

// ---------- Painting sessions ----------
export const useActiveSession = () =>
  useQuery({
    queryKey: ['sessions', 'active'],
    queryFn: () => api<{ session: PaintingSession | null }>('/sessions/active'),
    // Another device may start or stop the timer.
    refetchInterval: 30_000,
    select: (data) => data.session,
  });
export const useSessions = (miniatureId: number) =>
  useQuery({ queryKey: ['sessions', miniatureId], queryFn: () => api<PaintingSession[]>(`/sessions${qs({ miniature: miniatureId })}`) });
export const useStartSession = () =>
  useWrite((miniatureId: number) => api<PaintingSession>('/sessions/start', { method: 'POST', json: { miniatureId } }));
export const useStopSession = () => useWrite(() => api<{ session: PaintingSession | null }>('/sessions/stop', { method: 'POST', json: {} }));
export const useLogSession = () =>
  useWrite(({ miniatureId, minutes }: { miniatureId: number; minutes: number }) => {
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60_000);
    return api<PaintingSession>('/sessions', { method: 'POST', json: { miniatureId, startedAt: start.toISOString(), endedAt: end.toISOString() } });
  });
export const useUpdateSession = () =>
  useWrite(({ id, ...patch }: { id: number; notes?: string; durationSec?: number }) => api<PaintingSession>(`/sessions/${id}`, { method: 'PATCH', json: patch }));
export const useDeleteSession = () => useWrite((id: number) => api<void>(`/sessions/${id}`, { method: 'DELETE' }));

// ---------- AI assistant ----------
export const useAiStatus = () => useQuery({ queryKey: ['ai', 'status'], queryFn: () => api<AiStatus>('/ai/status'), staleTime: 300_000 });
export const useAiRuns = (miniatureId: number) =>
  useQuery({ queryKey: ['ai', 'runs', miniatureId], queryFn: () => api<AiRun[]>(`/ai/runs${qs({ miniature: miniatureId })}`) });
/** One mutation for the three kinds of request; answers can take a minute, so there is no client timeout. */
export const useAskAi = () =>
  useWrite(({ kind, ...body }: { kind: AiRun['kind']; miniatureId: number; photoId?: number | null; scheme?: string; focus?: string; query?: string }) =>
    api<AiRun>(`/ai/${kind}`, { method: 'POST', json: body }),
  );
export const useSaveAiRecipe = () => useWrite((runId: number) => api<{ recipeId: number }>(`/ai/runs/${runId}/save-recipe`, { method: 'POST', json: {} }));
export const useDeleteAiRun = () => useWrite((runId: number) => api<void>(`/ai/runs/${runId}`, { method: 'DELETE' }));

// ---------- Motivation ----------
export const useStreak = () => useQuery({ queryKey: ['streak'], queryFn: () => api<Streak>('/streak') });
// Badges are evaluated when read; every write refetches this, so a new one shows up right after the action that earned it.
export const useAchievements = () => useQuery({ queryKey: ['achievements'], queryFn: () => api<Achievement[]>('/achievements') });
export const useMarkAchievementsSeen = () => useWrite((keys: string[]) => api<{ ok: true }>('/achievements/seen', { method: 'POST', json: { keys } }));
export const useChallenges = () => useQuery({ queryKey: ['challenges'], queryFn: () => api<Challenge[]>('/challenges') });
export const useCreateChallenge = () => useWrite((input: ChallengeInput) => api<Challenge>('/challenges', { method: 'POST', json: input }));
export const useUpdateChallenge = () =>
  useWrite(({ id, ...patch }: { id: number; abandoned?: boolean; dueOn?: string | null }) => api<Challenge>(`/challenges/${id}`, { method: 'PATCH', json: patch }));
export const useDeleteChallenge = () => useWrite((id: number) => api<void>(`/challenges/${id}`, { method: 'DELETE' }));
export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats') });
