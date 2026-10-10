# Architecture

## Repository layout

```
smart-society/
├── packages/shared      Roles & permissions, state machines, schedule maths, Zod request schemas,
│                        API response types. Imported as TypeScript by both apps (single source of truth).
├── apps/api             Node 22 · Express 5 · Mongoose 8 · Zod 4 · pino
│   ├── src/config       Environment schema (fails fast on bad config)
│   ├── src/models       All Mongoose schemas + indexes (one file)
│   ├── src/middleware   session loader, CSRF, rate limits, error mapping
│   ├── src/lib          request context & permission guards, validation, crypto, DTO helpers
│   ├── src/services     audit log, notifications (+ channel status), email providers, file storage, invites
│   ├── src/modules      one router per domain: auth, platform, society, visitors, parking,
│   │                    complaints, announcements, amenities, notifications, insights
│   ├── src/scripts      seed (demo data), visitor-retention purge
│   └── test             integration tests (supertest) + DB harness + wire-protocol test double
└── apps/web             React 19 · Vite 8 · TypeScript · Tailwind CSS 4 · React Router 7 ·
    │                    TanStack Query 5 · React Hook Form + Zod · Radix (dialogs) · Motion · Lenis ·
    │                    @shadergradient/react (three + @react-three/fiber)
    ├── src/components   ui/ primitives (button, field, dialog, panel, states, cloud-shader…),
    │                    layout/ (PublicLayout, AppShell), visual/ (Atmosphere, SmoothScroll, Reveal)
    ├── src/features     one folder per domain (pages + feature components)
    ├── src/pages        public pages (home, privacy, 404)
    └── src/lib, hooks   API client, formatting (society time zone), session/theme hooks
```

## Request flow

```
Browser ──(same-origin /api, cookies)──> nginx / Vite proxy ──> Express
  pino-http (request id) → helmet → CORS allow-list → JSON (100 kB) → cookie-parser
  → general rate limit → loadSession → csrfProtection → no-store → domain router
     router: requirePermission(req, '<permission>')  → SocietyContext {user, membership, society}
             parse(zodSchema, body)                  → typed input or 400 with field errors
             service logic, every query filtered by societyId (+ unitId / userId where owned)
             audit(...) for high-impact actions, notify(...) for affected users
  → errorHandler (AppError → status/code; Mongo dup key → 409; anything else → 500 without details)
```

`loadSession` resolves the opaque cookie (SHA-256 lookup), enforces absolute and idle expiry,
loads the user and the **active membership**; if that membership was suspended or its society
suspended, it falls back to another active membership or none. Every handler therefore sees the
caller's current role, not the role at sign-in time.

## Authorization model

* Roles: `admin`, `committee`, `guard`, `resident`, `staff` (per society, via `Membership`), plus a
  user-level `isPlatformAdmin` flag. A user may belong to several societies; one is active per session.
* `packages/shared/src/roles.ts` maps roles → permissions. The API checks permissions with
  `requirePermission` / `requireAnyPermission`; the web app reads the same table only to shape
  navigation (`RequirePermission` is a courtesy, not a control).
* Record ownership is enforced in queries: e.g. residents' invitations filter `unitId = own unit`;
  staff see complaints where `assigneeUserId = me`; complaint actions compute the caller's relation
  (`reporter` / `manager` / `assignee`) and consult the shared state machine.
* Out-of-scope ids return `404` (same as non-existent) to avoid existence leaks (BOLA/IDOR).
* Data minimisation by role: guards get unit labels without residents (`/society/gate-units`),
  masked visitor phones, vehicle lookups without owner names; committee sees members without
  contact details; platform admins see counts only.

## Concurrency and integrity

| Rule | Mechanism |
|---|---|
| A pass is used once | `findOneAndUpdate({status:'active', window})` claim + unique partial index `Visit.invitationId` |
| A walk-in is decided once | conditional update on `status:'awaiting_approval'` |
| No overbooking | `SlotCounter` per (amenity, slot) with unique index; booking does a conditional `$inc` upsert (`count < capacity`). When full the upsert's insert collides with the unique index → `409 slot_full`. Cancellation decrements. |
| A household holds a slot once | unique partial index (amenity, slotStart, unit) where `status:'confirmed'` |
| One slot ↔ one vehicle | unique partial indexes on `ParkingAssignment.slotId` and `.vehicleId` where `active:true` |
| Complaint status changes don't overwrite each other | update filtered by the expected current status (`409 stale`) |
| Sequential complaint numbers | atomic `$inc` on `Society.complaintCounter` + unique (society, number) |
| Unique codes/labels | unique indexes: user email, (society, building code), (building, unit number), (society, plate), (society, slot code), (society, pass code), session token hash |

No multi-document transactions are used, so the API also runs on a standalone `mongod`
(replica sets work too). The per-unit booking limit is checked before reserving and is therefore
best-effort under extreme concurrency (documented in SECURITY.md).

Indexes are declared in `src/models/index.ts` and created at start-up (`connectDatabase`), with
`autoIndex` disabled.

## Time

Each society has an IANA time zone. Slots, "today" on the gate board, report day buckets and the
dates shown in the UI use it (Luxon on both sides; MongoDB `$dateToString` with `timezone`). The
web app sets its display zone from the active membership.

## Notifications

`services/notifications.ts` writes in-app notifications (respecting each user's muted types) and,
if the user opted in and an email provider is configured, sends an email copy in the background.
Email failures are logged and never fail the business action. `channelStatuses()` reports honestly
which channels are live; SMS / WhatsApp / push are shown as "not set up" because no adapter exists.

## Front end

* **Public site** (`PublicLayout`): one `Atmosphere` instance (ShaderGradient water plane, loaded
  lazily with three.js) behind every public page, a fixed paper-grain overlay, and the single Lenis
  instance (`SmoothScroll`). The homepage hero is a full-bleed `CloudShader` (ray-marched volumetric clouds) behind the header.
* **App** (`AppShell`): role-filtered sidebar / mobile drawer, notification bell (polled every 30 s),
  a *static* gradient derived from the ShaderGradient palette, native scrolling, no reveal motion.
  The guard's gate desk is intentionally plain, large and high contrast.
* Server state lives in TanStack Query; forms use React Hook Form with the shared Zod schemas, and
  server field errors are mapped back onto the form.
* Every authenticated page and the public pages are lazy route chunks; the WebGL stack is its own
  chunk loaded only by the atmosphere layer.

### Layer order

`html background` → `Atmosphere` (fixed, `-z-10`) → paper grain (`fixed`, `z-0`,
`pointer-events:none`, ~1.5 % opacity) → page content (`z-10`) → sticky header (`z-30`) →
dialogs, drawers and toasts (`z-50`, portalled). Canvases never take pointer events.

### Fallbacks

| Situation | Behaviour |
|---|---|
| No WebGL / shader compile or link fails / context lost | CloudShader swaps to a CSS gradient of the same colours; Atmosphere keeps the static gradient (the lazy layer is skipped, and an error boundary catches runtime failures) |
| `prefers-reduced-motion` | Lenis is not created; CloudShader drifts at a quarter speed; ShaderGradient `animate="off"`; reveal animations disabled; CSS transitions shortened to ~0 |
| Hidden tab / off-screen hero | CloudShader stops its animation loop (visibilitychange + IntersectionObserver); browsers throttle the r3f loop in hidden tabs |
| Dark theme | Separately tuned palette; CloudShader gets night colours; ShaderGradient is blended with `soft-light` |
