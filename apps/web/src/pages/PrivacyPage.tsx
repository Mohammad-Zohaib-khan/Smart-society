import { Link } from 'react-router';

const sections: { title: string; body: string[] }[] = [
  {
    title: 'What is stored',
    body: [
      'For members: name, email, optional phone number, role, and the home they belong to. Passwords are stored only as salted scrypt hashes.',
      'For visitors: the name, optional phone number, purpose, number of people, optional vehicle number and the entry and exit times recorded at the gate.',
      'Operational records: complaints and their history, uploaded photos or PDFs, amenity bookings, vehicles and parking assignments, notices and who has read them.',
    ],
  },
  {
    title: 'Who can see what',
    body: [
      'Residents see their own home’s records. Guards see the gate desk: home labels and masked visitor phone numbers, never a resident directory. Maintenance staff see only work assigned to them.',
      'The society admin sees the society’s records and members’ contact details. Committee members see names and homes but not contact details. Platform administrators see counts per society, not residents’ records.',
      'These rules are enforced by the server on every request.',
    ],
  },
  {
    title: 'How long visitor data is kept',
    body: ['Each society sets a retention period (180 days unless changed). After it, visitor names, phone numbers and vehicle numbers are replaced in the log; the entry itself remains as a count for reports.'],
  },
  {
    title: 'Sessions and cookies',
    body: ['Signing in sets an HTTP-only session cookie and a separate security token that protects forms against cross-site requests. No advertising or analytics cookies are used. Your theme choice is kept in your browser’s local storage.'],
  },
  {
    title: 'Messages we send',
    body: ['In-app notifications are always on. Email copies are sent only if your society’s deployment has email configured and you turn them on in your profile. SMS, WhatsApp and push messages are not part of this version.'],
  },
];

export function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl px-5 pt-8 pb-24 sm:px-8">
      <h1 className="text-4xl leading-tight sm:text-5xl">How Smart Society handles data</h1>
      <p className="mt-4 text-lg text-muted">
        This describes how the software behaves. Your society, as the operator of its deployment, is responsible for its own privacy notice and for answering requests about your data — contact your society office.
      </p>
      {sections.map((s) => (
        <section key={s.title} className="mt-12">
          <h2 className="text-2xl">{s.title}</h2>
          {s.body.map((p) => (
            <p key={p} className="mt-3 leading-relaxed text-foreground/85">
              {p}
            </p>
          ))}
        </section>
      ))}
      <p className="mt-14">
        <Link to="/" className="text-terracotta-ink underline underline-offset-4">
          Back to the home page
        </Link>
      </p>
    </article>
  );
}
