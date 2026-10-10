import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { toast } from 'sonner';
import { password, requestPasswordResetSchema } from '@smart-society/shared';
import { api, ApiError } from '@/lib/api';
import { handleFormError } from '@/lib/forms';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { AuthFrame } from './AuthFrame';

type RequestValues = z.infer<typeof requestPasswordResetSchema>;

export function ForgotPasswordPage() {
  const form = useForm<RequestValues>({ resolver: zodResolver(requestPasswordResetSchema), defaultValues: { email: '' } });
  const m = useMutation({ mutationFn: (v: RequestValues) => api.post('/auth/password-reset/request', v) });
  const unavailable = m.error instanceof ApiError && m.error.status === 503;

  if (m.isSuccess) {
    return (
      <AuthFrame title="Check your email" intro="If that address has an account, a reset link is on its way. It works for 30 minutes.">
        <ButtonLink to="/login" variant="secondary">
          Back to sign in
        </ButtonLink>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Reset your password" intro="We’ll email you a link to choose a new one.">
      <form noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-5">
        {m.error && (
          <p role="alert" className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning-ink">
            {unavailable ? 'Email isn’t set up for this deployment, so reset links can’t be sent. Ask your society office to send you a new invitation.' : m.error.message}
          </p>
        )}
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={m.isPending}>
          Send reset link
        </Button>
        <p className="text-center text-sm">
          <Link to="/login" className="text-terracotta-ink underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthFrame>
  );
}

const resetForm = z.object({ password, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: 'Passwords don’t match', path: ['confirm'] });
type ResetValues = z.infer<typeof resetForm>;

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const form = useForm<ResetValues>({ resolver: zodResolver(resetForm), defaultValues: { password: '', confirm: '' } });
  const m = useMutation({
    mutationFn: (v: ResetValues) => api.post('/auth/password-reset/confirm', { token, password: v.password }),
    onSuccess: () => {
      toast.success('Password changed. Sign in with your new password.');
      navigate('/login');
    },
    onError: (e) => handleFormError(e, form.setError, ['password']),
  });
  return (
    <AuthFrame title="Choose a new password" intro="This signs you out on every other device.">
      <form noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))} className="space-y-5">
        <Field label="New password" hint="At least 10 characters, with a letter and a number." error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Field label="Repeat it" error={form.formState.errors.confirm?.message}>
          <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={m.isPending} disabled={!token}>
          Save new password
        </Button>
      </form>
    </AuthFrame>
  );
}
