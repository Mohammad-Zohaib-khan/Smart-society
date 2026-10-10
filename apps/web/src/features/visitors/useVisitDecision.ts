import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';

/** Resident approves or denies a walk-in waiting at the gate for their home. */
export function useVisitDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'deny' }) => api.post(`/visitors/visits/${id}/decision`, { decision }),
    onSuccess: (_d, v) => {
      toast.success(v.decision === 'approve' ? 'Approved — the guard has been told to let them in' : 'Denied — the guard has been told');
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['visits'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}
