export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    ...(json !== undefined && { body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const photoUrl = (id: number) => `/api/media/photos/${id}`;
export const thumbUrl = (id: number, width: 200 | 400 | 800 | 1600 = 400) => `/api/media/thumbs/${id}?w=${width}`;
