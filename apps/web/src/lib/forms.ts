import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError, errorMessage } from './api';

/** Maps server-side field errors onto the form; anything else becomes a toast. */
export function handleFormError<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>, known: readonly string[] = []): void {
  if (e instanceof ApiError && e.fields) {
    let mapped = false;
    for (const [field, message] of Object.entries(e.fields)) {
      if (!known.length || known.includes(field)) {
        setError(field as Path<T>, { type: 'server', message });
        mapped = true;
      }
    }
    if (mapped) return;
  }
  toast.error(errorMessage(e));
}
