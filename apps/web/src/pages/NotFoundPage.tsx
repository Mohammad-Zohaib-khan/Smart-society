import { ButtonLink } from '@/components/ui/button';

export function NotFoundPage({ inApp = false }: { inApp?: boolean }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-5 py-24 text-center">
      <p className="font-serif text-7xl text-sage">404</p>
      <h1 className="mt-4 text-3xl">This page doesn’t exist</h1>
      <p className="mt-2 text-muted">The link may be out of date, or the page may have moved.</p>
      <ButtonLink to={inApp ? '/app' : '/'} className="mt-8">
        {inApp ? 'Back to overview' : 'Go to the home page'}
      </ButtonLink>
    </div>
  );
}
