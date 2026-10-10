import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { acceptInviteSchema, type SessionInfo } from '@smart-society/shared';
import { api } from '@/lib/api';
import { handleFormError } from '@/lib/forms';
import { useSetSession } from '@/hooks/useSession';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ErrorState, ListSkeleton } from '@/components/ui/states';
import { AuthFrame } from './AuthFrame';

interface InvitePreview {
  email: string;
  name: string;
  roleLabel: string;
  societyName: string;
  unitLabel: string | null;
  existingAccount: boolean;
}

const formSchema = acceptInviteSchema.omit({ token: true });
type FormValues = z.infer<typeof formSchema>;

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const setSession = useSetSession();
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<InvitePreview>(`/auth/invites/${encodeURIComponent(token)}`),
    enabled: token.length > 20,
    retry: false,
  });
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), values: { name: preview.data?.name ?? '', password: '' } });
  const accept = useMutation({
    mutationFn: (v: FormValues) => api.post<SessionInfo>('/auth/invites/accept', { ...v, token }),
    onSuccess: (s) => {
      setSession(s);
      navigate('/app', { replace: true });
    },
    onError: (e) => handleFormError(e, form.setError, ['name', 'password']),
  });

  if (token.length <= 20) {
    return (
      <AuthFrame title="Invitation link incomplete" intro="Open the full link from your invitation, or ask your society office to send a new one.">
        <ButtonLink to="/login" variant="secondary">
          Go to sign in
        </ButtonLink>
      </AuthFrame>
    );
  }
  if (preview.isPending) return <ListSkeleton />;
  if (preview.isError || !preview.data)
    return (
      <AuthFrame title="This invitation can’t be used" intro="It may have expired, been replaced by a newer one, or already been accepted.">
        <ErrorState error={preview.error} />
      </AuthFrame>
    );
  const p = preview.data;
  return (
    <AuthFrame
      title={`Join ${p.societyName}`}
      intro={
        <>
          You’re invited as <strong className="font-medium text-foreground">{p.roleLabel}</strong>
          {p.unitLabel ? ` for ${p.unitLabel}` : ''}. Your sign-in email is {p.email}.
        </>
      }
    >
      <form noValidate onSubmit={form.handleSubmit((v) => accept.mutate(v))} className="space-y-5">
        <Field label="Your name" error={form.formState.errors.name?.message}>
          <Input autoComplete="name" {...form.register('name')} />
        </Field>
        <Field
          label={p.existingAccount ? 'Your existing password' : 'Choose a password'}
          hint={p.existingAccount ? 'This email already has an account. Enter its password to add this society.' : 'At least 10 characters, with a letter and a number.'}
          error={form.formState.errors.password?.message}
        >
          <Input type="password" autoComplete={p.existingAccount ? 'current-password' : 'new-password'} {...form.register('password')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={accept.isPending}>
          Accept and continue
        </Button>
      </form>
    </AuthFrame>
  );
}
