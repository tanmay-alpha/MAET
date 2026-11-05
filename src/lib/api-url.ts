/**
 * Origin of the MAET backend (Render), e.g. "https://maet.onrender.com". The Vercel
 * deployment serves only the SSR app and its own /api/market routes, so every other
 * backend call (/api/trpc, /api/paper) must target this origin. Empty when unset, in
 * which case requests stay same-origin (local dev / preview serving the API itself).
 */
export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

/** Joins a backend origin and an absolute API path; relative when no origin is configured. */
export function resolveApiUrl(baseUrl: string | undefined, path: string): string {
  return `${(baseUrl ?? "").replace(/\/$/, "")}${path}`;
}

/** URL for a backend API path such as /api/trpc/companies.searchCompanies. */
export function apiUrl(path: string): string {
  return resolveApiUrl(API_BASE_URL, path);
}
