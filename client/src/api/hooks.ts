import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Dashboard,
  Group,
  GroupInput,
  Health,
  Miniature,
  MiniatureInput,
  MiniatureList,
  Photo,
  PhotoPatch,
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
  const entries = Object.entries(params).filter(([, v]) => v);
  return entries.length > 0 ? `?${new URLSearchParams(entries as [string, string][])}` : '';
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
