import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { loginSchema, type LoginInput, type SessionInfo } from '@smart-society/shared';
import { api, ApiError } from '@/lib/api';
import { useSession, useSetSession } from '@/hooks/useSession';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { AuthFrame } from './AuthFrame';

export function LoginPage() {
  const session = useSession();
  const setSession = useSetSession();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const login = useMutation({
    mutationFn: (v: LoginInput) => api.post<SessionInfo>('/auth/login', v),
    onSuccess: (s) => {
      setSession(s);
      navigate(from && from.startsWith('/app') ? from : '/app', { replace: true });
    },
  });

  if (session.data) return <Navigate to="/app" replace />;
  const err = login.error instanceof ApiError ? login.error : null;

  return (
    <AuthFrame
      title="Sign in"
      intro="Use the email your society office invited."
      aside={<p className="font-serif text-2xl leading-snug text-foreground/80">Gate, upkeep and notices — in one quiet place.</p>}
    >
      <form noValidate onSubmit={form.handleSubmit((v) => login.mutate(v))} className="space-y-5">
        {err && (
          <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {err.message}
          </p>
        )}
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" inputMode="email" {...form.register('email')} />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={login.isPending}>
          Sign in
        </Button>
        <p className="text-center text-sm text-muted">
          <Link to="/forgot-password" className="text-terracotta-ink underline-offset-4 hover:underline">
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthFrame>
  );
}
