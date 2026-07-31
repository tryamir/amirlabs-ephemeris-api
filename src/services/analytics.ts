// Backend telemetry → PostHog, for the Fly-hosted ephemeris API.
//
// Node counterpart of `amirlabs_app/supabase/functions/_shared/analytics.ts`,
// and deliberately the same event and property shape: one shared PostHog
// project, one `api.request` event, broken down by `function`. That keeps the
// existing backend-wide "API Health" dashboard correct — Fly routes simply show
// up as new `function` values alongside the Supabase edge functions.
//
// Following the same rules as the edge version: anonymous and aggregate only
// (constant distinct_id, person profiles off), operational properties only, no
// PII, no request bodies. Errors go to the logs, never into an event.
//
// `api.request` is the documented exception to the "never emit without `app`"
// rule (see ARCHITECTURE.md): it is backend-wide rather than owned by any one
// app, so it stays untagged and the API Health tiles stay unfiltered. The
// `source` property is what separates this tier from the edge functions.

import type { Request, Response, NextFunction } from 'express';

const POSTHOG_HOST = 'https://us.i.posthog.com';
const BACKEND_DISTINCT_ID = 'backend';
const SOURCE = 'fly';

/**
 * Requests served since this process started. Zero means the next request is
 * the one that paid for waking the machine — `fly.toml` runs with
 * `auto_stop_machines = 'stop'` and `min_machines_running = 0`, so the machine
 * is stopped whenever it is idle and cold-starts on the next request.
 */
let requestsSinceBoot = 0;
const bootedAt = Date.now();

/** Seconds this process has been up. The prober uses it to spot a cold start. */
export const uptimeSeconds = (): number =>
  Math.round((Date.now() - bootedAt) / 100) / 10;

export const requestCount = (): number => requestsSinceBoot;

/**
 * Send a single event to PostHog. Fire-and-forget friendly: never throws, and
 * silently no-ops when POSTHOG_API_KEY is unset (e.g. local dev).
 */
export async function captureEvent(
  event: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return;

  try {
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: BACKEND_DISTINCT_ID,
        properties: {
          source: SOURCE,
          ...properties,
          // Keep events anonymous — do not create/update a person profile.
          $process_person_profile: false,
        },
      }),
    });
  } catch {
    // Telemetry must never affect the request path.
  }
}

/**
 * Collapse a URL to the route that served it, e.g. `/api/march-equinox`.
 *
 * Deliberately not `req.originalUrl`: path params and query strings would make
 * `function` a high-cardinality breakdown and the tiles unreadable. Anything
 * that is not a known mount point becomes `/other`, so that port scanners
 * probing random paths cannot invent hundreds of breakdown values either.
 */
const MOUNTS = new Set([
  '/api/version',
  '/api/chart',
  '/api/dasha',
  '/api/moon-phases',
  '/api/march-equinox',
  '/api/solar-return',
  '/health',
]);

function routeOf(req: Request): string {
  const path = req.path.replace(/\/+$/, '') || '/';
  if (MOUNTS.has(path)) return path;
  const segments = path.split('/').filter(Boolean).slice(0, 2);
  const prefix = `/${segments.join('/')}`;
  return MOUNTS.has(prefix) ? prefix : '/other';
}

/**
 * Emit one `api.request` per response, including the 401s from
 * `requireApiKey` — unauthenticated traffic is worth seeing precisely because
 * it still wakes a stopped machine and shows up on the bill.
 *
 * Mount this before the auth middleware so nothing escapes counting.
 */
export function telemetry(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const coldStart = requestsSinceBoot === 0;
  requestsSinceBoot += 1;

  // Resolved now rather than inside `finish`: mounting a router rewrites
  // `req.url` (and so `req.path`) to be relative to the mount point while it
  // dispatches, which would report every routed request as `/other`.
  const route = routeOf(req);

  res.on('finish', () => {
    const properties = {
      function: route,
      method: req.method,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      error: res.statusCode >= 500,
      // True for the first request after the machine woke up. This is the
      // number that says whether scale-to-zero is costing real latency.
      cold_start: coldStart,
    };

    console.log(JSON.stringify({ type: 'api.request', ...properties }));

    // Not awaited: telemetry must add no latency to the response. The machine
    // only stops after an idle period, so an in-flight POST has time to land.
    void captureEvent('api.request', properties);
  });

  next();
}
