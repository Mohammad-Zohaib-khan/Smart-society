# Security

## Threat model (summary)

| Actor | Goal | Main controls |
|---|---|---|
| Anonymous internet user | Take over accounts, enumerate users, spam | scrypt hashes, generic login errors with equal-time dummy hashing, account lockout (8 failures → 15 min), sign-in/reset rate limits, no public sign-up, single-use hashed invite/reset tokens |
| Member of society A | Read or change society B's data | every query filtered by the **server-resolved** active membership's `societyId`; ids outside scope → `404` (tested) |
| Resident | See neighbours' passes, complaints, vehicles; act as staff/admin | ownership filters (unit / reporter / assignee), permission table, strict Zod schemas reject extra fields (mass assignment), role changes only by admins and never on oneself (tested) |
| Guard | Harvest resident contact data | gate-only endpoints returning labels without names, masked visitor phones, plate lookup without owner names, rate-limited lookups |
| Staff | See unassigned work or other residents' details | complaint visibility limited to assigned work orders (tested) |
| Committee | Change operations | read-only permissions; no contact details |
| Platform admin | Bulk resident data | platform endpoints expose counts only |
| Malicious site | CSRF / clickjacking | SameSite=Lax cookies, double-submit token bound to the session, narrow CORS allow-list, `frame-ancestors 'none'` |
| Malicious upload | Stored XSS, path traversal, oversized files | content sniffing (JPEG/PNG/WebP/PDF only, client MIME ignored), random storage keys, sanitised display names, size/count limits, served with `nosniff`, sandbox CSP and `Content-Disposition: attachment` |

## Controls in the code

* **Passwords**: scrypt (N=2^17, r=8, p=1, 64-byte key, per-user salt; parameters stored with the
  hash). Minimum 10 characters with a letter and a digit. Tests use a lower N for speed only when
  `NODE_ENV=test`.
* **Sessions**: 256-bit random token in an HTTP-only, `SameSite=Lax` cookie (`Secure` and the
  `__Host-` prefix in production); only its SHA-256 is stored. Absolute TTL (default 7 d) and idle
  timeout (default 48 h), MongoDB TTL index cleanup, rotation on sign-in, revocation on logout,
  other sessions revoked on password change/reset. No tokens in `localStorage`.
* **CSRF**: required `X-CSRF-Token` on unsafe methods, equal to the CSRF cookie and to the token
  stored on the session. The web client refreshes it once automatically.
* **Input**: Zod strict schemas for every body; Express 5 "simple" query parser (no nested objects,
  so no `?a[$ne]=`); query helpers accept only strings/enums; regex input escaped; Mongoose
  `strictQuery`. Operator injection attempts are tested.
* **Authorization**: `requirePermission` on every handler + ownership predicates in queries; shared
  state machines for complaints, visits and bookings; last-admin protection.
* **Concurrency**: unique and partial-unique indexes, conditional updates (see ARCHITECTURE.md).
* **Headers**: helmet (API CSP `default-src 'none'`, HSTS, frameguard, CORP), `Cache-Control: no-store`
  on API responses, strict CSP for the web app in `deploy/nginx.conf.template`.
* **Errors & logs**: central handler; no stack traces to clients; pino with redaction of cookies,
  auth/CSRF headers, passwords, tokens and phone numbers; request logs contain method, path,
  status and request id only.
* **Privacy**: visitor data retention purge (per-society period, runs every 6 h and via
  `npm run purge-visitors`); exports mask visitor phones and neutralise spreadsheet formulas;
  no resident directory for non-admins.
* **Audit log**: settings changes, member invites/role/status changes, structure changes, gate
  decisions and check-ins/outs, complaint lifecycle, parking assignments, bookings, notices,
  exports, password changes.
* **Config**: environment validated at start-up; production refuses the console email provider,
  disabled rate limits and non-Secure cookies. `.env.example` holds placeholders only.

## Verified by automated tests

`apps/api/test/*.test.ts` — sign-in/lockout/enumeration parity, NoSQL operator payloads, CSRF
missing/wrong, session cookie flags and hashing, logout revocation, idle expiry, password change
revoking sessions, mass assignment, cross-society IDOR on complaints/visitors/members/staff,
role restrictions for guard/resident/staff/committee, privilege escalation, suspension taking
effect immediately, last-admin protection, upload type sniffing and attachment access control,
CSV formula injection, rate limiting of sign-in, race conditions for pass check-in, amenity
capacity and parking assignment. These run against a real MongoDB (mongodb-memory-server) by default.

## Known limitations / residual risks

1. **Test database**: in the build sandbox the integration suite ran against an in-process MongoDB
   wire-protocol *test double* because MongoDB binaries could not be downloaded. Run
   `npm test` on a machine with internet access (uses a real `mongod` via mongodb-memory-server)
   before production.
2. **Per-unit booking limit** (`maxActiveBookingsPerUnit`) is checked before reserving capacity, so
   two simultaneous requests from the same household could exceed it by one. Capacity itself and
   same-slot duplicates are race-safe.
3. **Rate limiting is in-memory** (per API process). With several API instances use a shared
   store (e.g. `rate-limit-redis`).
4. **Uploads are stored on local disk** and are not virus-scanned. Use a persistent volume, and
   add scanning / object storage for larger deployments.
5. **No MFA** and no session list UI yet.
6. **Invite links shown to the inviter** when email isn't configured: anyone holding the link can
   accept it until it expires (7 days) or is revoked. Share it privately.
7. **Dependency audit** (npm 11, 2026-10-09): 1 low-severity advisory remains — esbuild ≤0.28.0
   bundled with tsup, affecting only esbuild's dev server on Windows (not used here).
8. **SMS / WhatsApp / push / payments / AI** are not implemented; the app says so where relevant.

## Reporting

Report vulnerabilities privately to the deployment operator. Do not open public issues with
exploit details.
