import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Permission, SessionInfo } from '@smart-society/shared';
import { api, ApiError } from '@/lib/api';
import { setDisplayZone } from '@/lib/format';
import { STATIC_PREVIEW } from '@/lib/preview';

export const sessionKey = ['session'] as const;

/** The signed-in user, or null when signed out. Errors other than 401 surface to the caller. */
export function useSession() {
  const query = useQuery({
    queryKey: sessionKey,
    queryFn: async () => {
      if (STATIC_PREVIEW) return null; // no server in the static preview: always signed out
      try {
        return await api.get<SessionInfo>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
  });
  const tz = query.data?.membership?.timezone;
  useEffect(() => {
    if (tz) setDisplayZone(tz);
  }, [tz]);
  return query;
}

export function useSetSession() {
  const qc = useQueryClient();
  return (session: SessionInfo | null) => {
    if (session?.membership) setDisplayZone(session.membership.timezone);
    qc.setQueryData(sessionKey, session);
  };
}

/** Navigation hints only — every permission is enforced again by the API. */
export function useCan() {
  const { data } = useSession();
  const set = new Set<Permission>(data?.permissions ?? []);
  return (p: Permission) => set.has(p);
}
