// Uptime probe for the Fly-hosted ephemeris API. Run on a schedule by
// .github/workflows/uptime.yml; emits one `ephemeris.probe` event to PostHog.
//
// This is monitoring, NOT a keep-alive. The Supabase equivalent
// (`amirlabs-web/src/pages/api/keepalive.ts`) exists because a free Supabase
// project is *permanently paused* after 7 idle days and needs a manual restore.
// Fly is not like that: `fly.toml` sets `auto_stop_machines = 'stop'` with
// `auto_start_machines = true`, so an idle machine stops to save money and the
// next request starts it again on its own. Nothing here is trying to prevent
// that — the point is to measure how often it happens and what it costs in
// latency. Probing more often would keep the machine awake and defeat the
// scale-to-zero saving, which is the opposite of the goal.
//
// Usage:
//   node scripts/probe.mjs                          # the deployed app
//   node scripts/probe.mjs http://localhost:3000/health
// Env: EPHEMERIS_HEALTH_URL (optional), POSTHOG_API_KEY (optional; no-ops without).

const URL_UNDER_TEST =
  process.argv[2] ??
  process.env.EPHEMERIS_HEALTH_URL ??
  'https://ephemeris-api-wispy-wind-3393.fly.dev/health';

const POSTHOG_HOST = 'https://us.i.posthog.com';
const TIMEOUT_MS = 30_000; // A cold machine start can take a few seconds.

/** One timed GET against /health. Never throws; a dead host is a result, not an error. */
async function probe() {
  const start = Date.now();
  try {
    const res = await fetch(URL_UNDER_TEST, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const duration_ms = Date.now() - start;

    // A non-2xx still counts as "answered", so read the body defensively.
    let body = {};
    try {
      body = await res.json();
    } catch {
      // Not JSON — an edge proxy error page, most likely.
    }

    return {
      ok: res.ok && body.ok === true,
      status: res.status,
      duration_ms,
      uptime_s: typeof body.uptime_s === 'number' ? body.uptime_s : null,
      // The app counts requests since boot, and the telemetry middleware counts
      // this one before the handler runs. So `requests === 1` means this probe
      // is the request that woke a stopped machine — an exact cold-start signal,
      // with no latency threshold to guess at.
      cold_start: body.requests === 1,
    };
  } catch (error) {
    // Timeout, DNS failure, connection refused: the app is not answering.
    return {
      ok: false,
      status: null,
      duration_ms: Date.now() - start,
      uptime_s: null,
      cold_start: false,
      detail: error instanceof Error ? error.message : 'fetch failed',
    };
  }
}

async function capture(event, properties) {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    console.warn('POSTHOG_API_KEY unset — probing without reporting.');
    return;
  }
  try {
    const res = await fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: 'backend',
        properties: { source: 'fly', ...properties, $process_person_profile: false },
      }),
    });
    if (!res.ok) console.warn(`PostHog capture -> ${res.status}`);
  } catch (error) {
    // Losing one datapoint must not turn a healthy app into a red run.
    console.warn(`PostHog capture failed: ${error.message}`);
  }
}

// A single dropped connection is a blip, not an outage. Retry once so the
// scheduled run only goes red when the app is really unreachable; `attempts`
// keeps the retry visible rather than hiding a flaky endpoint behind a green run.
let result = await probe();
let attempts = 1;
if (!result.ok) {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  result = await probe();
  attempts = 2;
}

console.log(JSON.stringify({ type: 'ephemeris.probe', attempts, ...result }, null, 2));
await capture('ephemeris.probe', { attempts, ...result });

// Non-zero so a real outage surfaces as a failed workflow run and GitHub emails
// about it, instead of a green check with a bad number buried inside.
if (!result.ok) process.exit(1);
