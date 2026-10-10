import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { CalendarCheck, Car, ClipboardCheck, EyeOff, Megaphone, ShieldCheck, Timer, UserRoundCheck } from 'lucide-react';
import { CloudShader } from '@/components/ui/cloud-shader';
import { ButtonLink } from '@/components/ui/button';
import { Reveal } from '@/components/visual/Reveal';
import { PassTicket } from '@/features/visitors/PassTicket';
import { useThemeContext } from '@/providers';
import { useSession } from '@/hooks/useSession';
import { useReducedMotion } from '@/hooks/useMedia';
import heroDashboard from '@/assets/hero-dashboard.webp';

const sampleValidFrom = '2026-10-17T12:30:00.000Z';
const sampleValidUntil = '2026-10-17T16:30:00.000Z';

const gateSteps = [
  { title: 'A resident creates a pass', body: 'Name, time window and number of people. The app returns a six-character code to share.' },
  { title: 'The guard types the code', body: 'Valid, early, expired or already used — the answer is immediate, with the home it belongs to.' },
  { title: 'Check-in and check-out are timestamped', body: 'The resident is told when their guest arrives and leaves. Each pass works once.' },
];

const roles = [
  { role: 'Residents', sees: 'Their own home: passes, visitors, complaints, bookings, vehicles and household.' },
  { role: 'Guards', sees: 'The gate desk only. Home labels, never a resident directory; visitor numbers are masked.' },
  { role: 'Maintenance staff', sees: 'The work orders assigned to them, with notes and photos of the finished job.' },
  { role: 'The society office', sees: 'Structure, members, assignments, parking, notices, reports and the audit log.' },
];

export function HomePage() {
  const { dark } = useThemeContext();
  const { data: session } = useSession();
  const { hash } = useLocation();
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    el?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, [hash, reduced]);

  return (
    <>
      {/* Hero: a full-bleed moving cloud sky (CloudShader as a background layer, as in the
          supplied demo), the message centred over it, and the real app rising out of the clouds.
          The section slides up under the transparent header so the sky runs behind it. */}
      <section className="relative -mt-20 overflow-hidden">
        <CloudShader
          className="absolute inset-0"
          speed={1}
          count={3}
          cloudColor={dark ? '#7b8796' : '#ffffff'}
          skyTopColor={dark ? '#0b1420' : '#3f7fc2'}
          skyBottomColor={dark ? '#1d2834' : '#d6e6f4'}
        />
        {/* A soft shade behind the copy keeps white text readable whatever cloud passes behind it. */}
        <div aria-hidden data-hero-scrim className="pointer-events-none absolute inset-x-0 top-0 h-[44rem] bg-[radial-gradient(120%_60%_at_50%_52%,rgb(12_34_62/0.78),rgb(12_34_62/0.48)_58%,transparent_84%)] md:bg-[radial-gradient(66%_64%_at_50%_57%,rgb(12_34_62/0.78),rgb(12_34_62/0.48)_58%,transparent_84%)]" />
        {/* Fade the sky into the page so the next section starts on the page ground. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-b from-transparent to-background" />

        <div data-hero-copy className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-5 pt-36 text-center text-white sm:px-8 md:pt-44">
          <Reveal>
            <h1 className="font-serif text-[2.7rem] leading-[1.02] font-semibold text-balance [text-shadow:0_2px_24px_rgb(10_30_60/0.45)] sm:text-6xl lg:text-[5.25rem]">
              Your society, run <em className="font-medium italic">calmly</em>.
            </h1>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-white/95 [text-shadow:0_1px_14px_rgb(10_30_60/0.55)] md:text-xl">
              Visitors at the gate, repairs, amenity bookings, parking and notices — one place for the people who live there and the people who keep it running.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink to={session ? '/app' : '/login'} size="lg" className="bg-white text-[#2d3a31] shadow-lift hover:bg-white/90">
                {session ? 'Open your society' : 'Sign in'}
              </ButtonLink>
              <ButtonLink to="/#gate" size="lg" variant="secondary" className="border-white/55 bg-white/12 text-white backdrop-blur-sm hover:border-white hover:bg-white/22">
                See how the gate works
              </ButtonLink>
            </div>
            <p className="mt-4 text-[0.95rem] font-medium text-white [text-shadow:0_1px_10px_rgb(10_30_60/0.6)]">Members join by invitation from their society office.</p>
          </Reveal>
        </div>

        {/* The product itself, framed like a window in an arch. */}
        <div className="relative z-10 mx-auto mt-14 w-full max-w-6xl px-4 pb-10 md:mt-20 md:px-8">
          <Reveal delay={0.25}>
            <figure className="rounded-t-[2rem] rounded-b-2xl border border-white/50 bg-surface/30 p-2 shadow-lift backdrop-blur-md md:rounded-t-[3rem] md:p-3 dark:border-white/10">
              <img
                src={heroDashboard}
                width={1440}
                height={900}
                alt="The society admin overview in Smart Society: open complaints, visitors inside, bookings, parking use, complaints by status and recent activity"
                className="w-full rounded-t-[1.5rem] rounded-b-xl border border-border md:rounded-t-[2.5rem]"
              />
            </figure>
          </Reveal>
        </div>
      </section>

      <p className="mx-auto max-w-6xl px-5 pb-16 text-center text-muted sm:px-8">
        Each person sees only what their role needs. Permissions are checked by the server on every request — not just hidden in the interface.
      </p>

      {/* Gate — a real sequence, so it is numbered. */}
      <section id="gate" className="scroll-mt-24 border-t border-border/70 py-24">
        <div className="mx-auto grid max-w-6xl gap-14 px-5 sm:px-8 lg:grid-cols-[1fr_22rem] lg:items-center">
          <div>
            <Reveal>
              <h2 className="max-w-[18ch] text-4xl leading-tight sm:text-5xl">No phone calls to the flat, no paper register.</h2>
              <p className="mt-4 max-w-xl text-lg text-muted">Walk-ins wait for the resident’s answer in the app, or the guard records an intercom reply. Society policy decides whether guards may let someone in on their own.</p>
            </Reveal>
            <ol className="mt-10 space-y-7">
              {gateSteps.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[3rem_1fr] gap-4">
                  <span className="tabular font-serif text-3xl text-terracotta-ink" aria-hidden>
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-sans text-lg font-semibold">{s.title}</h3>
                    <p className="mt-1 text-muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <Reveal delay={0.1}>
            <figure>
              <PassTicket invitation={{ code: 'K7PQ4M', visitorName: 'Asha Rao', purpose: 'guest', guestCount: 2, validFrom: sampleValidFrom, validUntil: sampleValidUntil }} />
              <figcaption className="mt-3 text-center text-sm text-muted">Example pass. Guards see the name and home; the phone number stays with the household.</figcaption>
            </figure>
          </Reveal>
        </div>
      </section>

      {/* Upkeep — staggered editorial rows rather than a card grid. */}
      <section id="upkeep" className="scroll-mt-24 border-t border-border/70 py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <Reveal>
            <h2 className="max-w-[20ch] text-4xl leading-tight sm:text-5xl">The everyday upkeep, followed through to the end.</h2>
          </Reveal>
          <div className="mt-14 grid gap-x-16 gap-y-14 md:grid-cols-2">
            {[
              { icon: ClipboardCheck, title: 'Complaints that reach someone', body: 'The office assigns a staff member and a due date. Staff post progress and a photo of the finished job; the resident closes it or sends it back.' },
              { icon: CalendarCheck, title: 'Bookings that can’t clash', body: 'Slots follow each amenity’s hours and capacity. Two households can’t take the last place at the same moment, and cancelling frees it again.' },
              { icon: Car, title: 'One car, one slot', body: 'Slots are allocated by the office and match the vehicle type. The gate can look up a plate to see which home it belongs to.' },
              { icon: Megaphone, title: 'Notices people actually see', body: 'Target everyone, a role or a single tower. Pinned notices sit on residents’ overview, and the office can see how many have read each one.' },
            ].map((f, i) => (
              <Reveal key={f.title} delay={i % 2 ? 0.12 : 0} className={i % 2 ? 'md:mt-16' : ''}>
                <div className="border-t border-border pt-6">
                  <f.icon className="size-7 text-sage-ink" strokeWidth={1.25} aria-hidden />
                  <h3 className="mt-4 text-2xl">{f.title}</h3>
                  <p className="mt-2 max-w-md text-muted">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border/70 py-24">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 sm:px-8 lg:grid-cols-[20rem_1fr]">
          <Reveal>
            <h2 className="text-4xl leading-tight">Four roles, four views.</h2>
          </Reveal>
          <dl className="divide-y divide-border border-y border-border">
            {roles.map((r) => (
              <div key={r.role} className="grid gap-1 py-5 sm:grid-cols-[12rem_1fr] sm:gap-6">
                <dt className="font-serif text-xl">{r.role}</dt>
                <dd className="text-muted">{r.sees}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="privacy" className="scroll-mt-24 border-t border-border/70 py-24">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="overflow-hidden rounded-t-[12rem] rounded-b-[2rem] border border-sage/40 bg-sage-soft px-6 pt-20 pb-12 sm:px-14 sm:pt-28">
            <Reveal>
              <h2 className="mx-auto max-w-[22ch] text-center text-4xl leading-tight sm:text-5xl">Visitor details don’t linger.</h2>
            </Reveal>
            <ul className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-3">
              {[
                { icon: Timer, text: 'Names, phone numbers and plates are erased from the visitor log after the period your society sets.' },
                { icon: EyeOff, text: 'Guards see masked phone numbers. Exports never include full visitor numbers.' },
                { icon: ShieldCheck, text: 'Every assignment, export and access change is recorded in an audit log the office can search.' },
              ].map((p) => (
                <li key={p.text} className="text-center">
                  <p.icon className="mx-auto size-7 text-sage-ink" strokeWidth={1.25} aria-hidden />
                  <p className="mt-3 text-foreground/85">{p.text}</p>
                </li>
              ))}
            </ul>
            <p className="mt-10 text-center">
              <Link to="/privacy" className="text-terracotta-ink underline underline-offset-4">
                How Smart Society handles data
              </Link>
            </p>
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-3xl px-5 text-center sm:px-8">
          <UserRoundCheck className="mx-auto size-8 text-sage-ink" strokeWidth={1.25} aria-hidden />
          <h2 className="mt-4 text-4xl leading-tight">Members join by invitation.</h2>
          <p className="mx-auto mt-3 max-w-xl text-lg text-muted">There’s no public sign-up. Your society office sends you a link; you choose a password and you’re in.</p>
          <div className="mt-8 flex justify-center">
            <ButtonLink to={session ? '/app' : '/login'} size="lg">
              {session ? 'Open your society' : 'Sign in'}
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
