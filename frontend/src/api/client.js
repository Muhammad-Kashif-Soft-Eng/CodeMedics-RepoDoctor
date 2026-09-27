/**
 * apiClient
 *
 * Thin wrapper around fetch for all Codemedics backend calls.
 * Base URL is read from the Vite env variable VITE_API_URL,
 * falling back to http://localhost:3001 for local development.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

async function request(method, path, body) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, options);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} → ${res.status}: ${text}`);
  }

  return res.json();
}

// ── Convenience helpers ───────────────────────────────────────────────────────

export const apiClient = {
  /** POST /api/scan — submit a repository URL for scanning */
  scan: (repoUrl) => request('POST', '/api/scan', { repoUrl }),

  /** POST /api/diagnose — generate findings from a completed scan result */
  diagnose: (scanResult) => request('POST', '/api/diagnose', scanResult),

  /** POST /api/prescribe — build a prescription from scan evidence and one finding */
  prescribe: (scanResult, selectedFinding) => request('POST', '/api/prescribe', {
    ...scanResult,
    selectedFinding,
  }),

  /** POST /api/treat — execute an approved prescription */
  treat: (prescriptionId) => request('POST', '/api/treat', { prescriptionId }),

  /** POST /api/verify — verify treatment and compute before/after */
  verify: (treatmentId) => request('POST', '/api/verify', { treatmentId }),
};
