/**
 * `VITE_STATIC_PREVIEW=1` builds a server-less preview of the public site (used to share a visual
 * preview). It never fakes data: sign-in and the app explain that they need the API server.
 */
export const STATIC_PREVIEW = import.meta.env.VITE_STATIC_PREVIEW === '1';
