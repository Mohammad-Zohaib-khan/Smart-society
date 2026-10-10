# Smart Society API reference

Base path: `/api`. All bodies are JSON unless noted. Response types are defined in
`packages/shared/src/api-types.ts`; request schemas in `packages/shared/src/schemas.ts` (Zod, strict —
unknown keys are rejected with `400`).

## Conventions

| Topic | Rule |
|---|---|
| Authentication | Session cookie (`ss_session`, or `__Host-ss_session` when `COOKIE_SECURE=true`), HTTP-only, `SameSite=Lax`. Opaque token; only its SHA-256 is stored. |
| CSRF | Every `POST/PUT/PATCH/DELETE` must send `X-CSRF-Token` equal to the `ss_csrf` cookie. For signed-in requests it must also match the token bound to the session. Get one with `GET /auth/csrf`. |
| Society scope | Every society route acts on the caller's **active membership** (switch with `POST /auth/switch-society`). Records outside it return `404`, never `403`, so existence is not leaked. |
| Errors | `{ "error": { "code": string, "message": string, "fields"?: { "<path>": "<message>" } } }`. No stack traces. |
| Pagination | `?page=1&pageSize=20` (max 100) → `{ items, page, pageSize, total }`. |
| Dates | ISO-8601 instants with offset. Calendar dates are `YYYY-MM-DD` in the **society time zone**. |
| Rate limits | General 1500 / 15 min / IP; sign-in 20 / 15 min; password reset 6 / h; gate lookups 90 / min; uploads 60 / 15 min. `429` with `code: rate_limited`. |

Common status codes: `400` validation, `401` not signed in, `403` role lacks permission or CSRF failed
(`code: csrf_failed`), `404` not found / out of scope, `409` state conflict (codes listed below),
`413` body too large, `415` unsupported upload, `423` account locked, `429` rate limited,
`503` feature not configured.

Permission names below are from `packages/shared/src/roles.ts`.

## Auth & profile — `/auth`

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/csrf` | anyone | Sets/returns the CSRF token. |
| POST | `/login` | anyone | `{email,password}` → `SessionInfo`. 8 failures lock the account 15 min (`423`). Rotates any existing session. |
| POST | `/logout` | signed in | Deletes the server session. `204`. |
| GET | `/me` | signed in | `SessionInfo` (`401` when signed out). |
| POST | `/switch-society` | signed in | `{membershipId}` — only memberships the user holds. |
| PATCH | `/profile` | signed in | `{name, phone?}`. |
| PUT | `/notification-prefs` | signed in | `{emailEnabled, mutedTypes[]}`. |
| POST | `/change-password` | signed in | `{currentPassword,newPassword}`; signs out other sessions. |
| POST | `/password-reset/request` | anyone | `{email}` → `202` whether or not the account exists. `503` if no email provider. |
| POST | `/password-reset/confirm` | anyone | `{token,password}`; single use, 30 min; signs out all sessions. |
| GET | `/invites/:token` | anyone | Invitation preview. |
| POST | `/invites/accept` | anyone | `{token,name,password}` → `201 SessionInfo`. Existing accounts must give their current password. |

## Platform — `/platform` (platform admins only)

| Method | Path | Notes |
|---|---|---|
| GET | `/societies` | Counts only (buildings, units, members) — no member data. |
| POST | `/societies` | `createSocietySchema` → `{societyId, invite: CreatedInvite}`; invites the first admin. |
| PATCH | `/societies/:id/status` | `{status: active|suspended}`. Suspension blocks all members. |

## Society — `/society`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/settings` | any member | `SocietySettings`. |
| PUT | `/settings` | `society.settings.manage` | Full settings document. Audited. |
| GET | `/buildings` | `structure.view` or `announcements.manage` | With unit counts. |
| POST / PATCH / DELETE | `/buildings[/:id]` | `structure.manage` | Code immutable; delete only when empty (`409`). |
| GET | `/units` | `structure.view` | Filters `buildingId,status,q`. |
| POST | `/units` | `structure.manage` | Duplicate number in building → `409`. |
| POST | `/units/bulk` | `structure.manage` | `{buildingId,fromFloor,toFloor,unitsPerFloor}` → `{created,skipped}`. |
| PATCH / DELETE | `/units/:id` | `structure.manage` | Can't mark vacant with residents; can't delete with history (`409`). |
| GET | `/gate-units?q=` | `gate.operate` | `GateUnitDto[]`: labels only, no names/phones. |
| GET | `/members` | `members.view` | Email/phone returned to admins only. |
| PATCH | `/members/:id` | `members.manage` | `{role?,unitId?,status?}`. Cannot change own role/status; last admin protected (`409`). |
| GET / POST / DELETE | `/invites[/:id]` | `members.manage` | `POST` → `CreatedInvite` (`acceptUrl` returned only when not emailed). |
| GET | `/staff` | `complaints.assign` | Active staff with open work-order counts. |
| GET / POST / PATCH / DELETE | `/household[/:id]` | `household.manageOwn` | Own unit only. Max 15. |

## Visitors — `/visitors`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/invitations?scope=upcoming|past&q=` | `visitors.viewOwn` (own unit) / `visitors.viewAll` | |
| POST | `/invitations` | `visitors.invite` | Policy-checked window (max days ahead, max hours). Returns pass `code`. |
| POST | `/invitations/:id/cancel` | resident (own unit) or admin | `409` unless active. |
| GET | `/visits?status&source&from&to&q` | `visitors.viewOwn` / `visitors.viewAll` | Phones masked unless host unit or admin. |
| POST | `/visits/:id/decision` | `visitors.decideOwnUnit` | `{decision: approve|deny}` on a walk-in for own unit. `409 already_decided`. |
| GET | `/gate/board` | `gate.operate` | `GateBoard`: expected today, awaiting, inside. |
| POST | `/gate/verify` | `gate.operate` | `{code}` → `PassVerification` with check-in verdict. |
| POST | `/gate/invitations/:id/check-in` | `gate.operate` | Atomic; `409` codes `not_yet_valid`, `expired`, `cancelled`, `already_used`. |
| POST | `/gate/walk-ins` | `gate.operate` | Creates `awaiting_approval`; notifies unit residents. |
| POST | `/gate/visits/:id/decision` | `gate.operate` | `{decision, method: intercom|phone_call|in_person, note?}`. `in_person` approval refused when policy requires residents. |
| POST | `/gate/visits/:id/withdraw` | `gate.operate` | Waiting visitor left. |
| POST | `/gate/visits/:id/check-out` | `gate.operate` | `409 not_inside`. |

## Parking — `/parking`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/vehicles?q=` | `vehicles.manageOwn` (own) / `vehicles.viewAll` | Includes current slot code. |
| POST / PATCH | `/vehicles[/:id]` | `vehicles.manageOwn` | Plates normalised; unique per society (`409`). |
| DELETE | `/vehicles/:id` | own vehicle or `parking.manage` | `409` while assigned. |
| GET | `/lookup/:registration` | `vehicles.lookup` | Unit label + slot only. |
| GET / POST / PATCH / DELETE | `/slots[/:id]` | `parking.manage` | Deactivate/retype blocked while occupied; delete blocked with history. |
| POST | `/slots/:id/assign` | `parking.manage` | `{vehicleId}`. Type must fit. `409 slot_occupied` / `vehicle_has_slot` (unique partial indexes). |
| POST | `/slots/:id/release` | `parking.manage` | Ends the active assignment. |
| GET | `/assignments` | `parking.manage` | History. |

## Complaints & work orders — `/complaints`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/?status=active|<status>&priority&category&assignee=me|none&q` | `complaints.viewOwn` / `viewAll` / `workOrders.viewAssigned` | Each item carries `allowedTransitions`, `canAssign`, `canComment` for the caller. |
| POST | `/` | `complaints.create` | Category must be in society settings. Sequential `number`. |
| GET | `/:id` | visibility as above | Internal notes hidden from residents. |
| POST | `/:id/assign` | `complaints.assign` | `{assigneeMembershipId, dueDate?, priority?}`; staff of this society only. |
| POST | `/:id/status` | reporter / manager / assignee per state machine | `{status, note?}`; note required to resolve or reopen. `409 invalid_transition` / `stale`. |
| POST | `/:id/comments` | reporter / manager / assignee | `{body, internal}`; `internal` for staff side only. |
| POST | `/:id/attachments` | as comments | `multipart/form-data`, field `files` (≤3, ≤`MAX_UPLOAD_MB`). Type detected from content: JPEG/PNG/WebP/PDF else `415`. |
| GET | `/attachments/:id` | same visibility as the complaint | `?inline=1` for images. `nosniff`, sandbox CSP. |

## Announcements — `/announcements`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/?status=` | `announcements.view` | Members see live notices for their audience; managers see all with `readStats`. |
| GET | `/:id` | `announcements.view` | |
| POST | `/:id/read` | `announcements.view` | Idempotent. |
| POST / PATCH | `/[:id]` | `announcements.manage` | Drafts. |
| POST | `/:id/publish` | `announcements.manage` | Notifies the audience → `{notified}`. |
| POST | `/:id/archive` | `announcements.manage` | |
| DELETE | `/:id` | `announcements.manage` | Drafts only. |

## Amenities — `/amenities`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/` | `amenities.view` | Inactive hidden from non-managers. |
| POST / PATCH | `/[:id]` | `amenities.manage` | Schedule can't change while future bookings exist. |
| GET | `/:id/availability?date=YYYY-MM-DD` | `amenities.view` | `SlotAvailability[]` in society time. |
| GET | `/bookings?scope=upcoming|past|all&amenityId&date` | `amenities.book` (own unit) / `bookings.viewAll` | |
| POST | `/bookings` | `amenities.book` | `{amenityId, slotStart}`. `409 slot_full`, `already_booked`, `unit_limit`. Race-safe. |
| POST | `/bookings/:id/cancel` | own unit, or `amenities.manage` | Cut-off for residents; `409 past_cutoff`, `started`, `already_cancelled`. Releases capacity. |

## Notifications — `/notifications` (signed in, scoped to the active society)

`GET /?unread=1`, `GET /unread-count`, `GET /channels` (honest per-channel status),
`POST /read-all`, `POST /:id/read`.

## Insights

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/dashboard` | any member | `DashboardResponse` shaped by role. |
| GET | `/reports/summary?from&to` | `reports.view` | ≤ 1 year. |
| GET | `/reports/export?kind=visits|complaints|bookings&from&to` | `reports.export` | CSV (UTF-8 BOM, formula-injection safe, visitor phones masked). Audited. |
| GET | `/audit?action&q&from&to` | `audit.view` | |

## Health

`GET /api/health` → `{ ok: true, time }` (no auth, no database call).
