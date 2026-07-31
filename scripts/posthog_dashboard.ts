// Creates the "Ephemeris API — Fly" dashboard in PostHog.
//
// Companion to `amirlabs_app/scripts/posthog_web_dashboards.ts` and
// `ordibehesht/scripts/posthog_dashboards.ts`, and the same caveat applies:
// PostHog has no upsert for dashboards, so re-running creates a fresh copy.
// Delete the old one first if you re-run after tweaking.
//
// Usage (both vars are already exported in the shell profile):
//   deno run --allow-net --allow-env scripts/posthog_dashboard.ts
//
// US cloud is assumed. For EU, change HOST to https://eu.posthog.com.

const HOST = "https://us.posthog.com";
const KEY = Deno.env.get("POSTHOG_PERSONAL_API_KEY");
const PROJECT = Deno.env.get("POSTHOG_PROJECT_ID");

if (!KEY || !PROJECT) {
  console.error("Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID.");
  Deno.exit(1);
}

const headers = {
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function api(path: string, body: unknown): Promise<{ id: number }> {
  const res = await fetch(`${HOST}/api/projects/${PROJECT}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

const createDashboard = (name: string, description: string) =>
  api("/dashboards/", { name, description });

const event = (
  name: string,
  math = "total",
  extra: Record<string, unknown> = {},
) => ({ kind: "EventsNode", event: name, math, ...extra });

const breakdown = (key: string) => ({
  breakdownFilter: { breakdown: key, breakdown_type: "event" },
});

const table = { trendsFilter: { display: "ActionsTable" } };
const bar = { trendsFilter: { display: "ActionsBarValue" } };

const prop = (key: string, value: unknown[], operator = "exact") => ({
  type: "event",
  key,
  value,
  operator,
});

// `api.request` is emitted by both backend tiers into one shared PostHog
// project, and the existing "Ordibehesht — API Health" dashboard reads it
// unfiltered on purpose (it is backend-wide). This dashboard is the Fly-only
// view, so every tile filters on the `source` property the Fly app attaches.
const FLY_ONLY = prop("source", ["fly"]);

// The uptime probe is the only caller of /health, so excluding that route is
// what separates real usage from monitoring traffic. Without this, a probe
// every 15 minutes would be by far the largest "user" of the API.
const NOT_HEALTH = prop("function", ["/health"], "is_not");

const trends = (
  series: unknown[],
  properties: unknown[],
  extra: Record<string, unknown> = {},
) => ({
  kind: "InsightVizNode",
  source: {
    kind: "TrendsQuery",
    series,
    interval: "day",
    dateRange: { date_from: "-7d" },
    properties,
    ...extra,
  },
});

async function insight(
  dashboard: number,
  name: string,
  query: unknown,
  description = "",
) {
  await api("/insights/", { name, description, query, dashboards: [dashboard] });
  console.log(`  + ${name}`);
}

// ---------------------------------------------------------------------------

console.log("Creating the ephemeris-api dashboard...");

const id = (await createDashboard(
  "Ephemeris API — Fly",
  "Availability and request health for the Fly-hosted Swiss Ephemeris API. " +
    "Uptime tiles come from the scheduled probe (.github/workflows/uptime.yml); " +
    "traffic tiles come from the app itself and exclude the probe's /health calls. " +
    "The app runs scale-to-zero, so a stopped machine is normal, not an outage.",
)).id;
console.log(`Dashboard #${id}`);

// --- Availability, from the scheduled probe -------------------------------

const probeSeries = (math = "total", extra: Record<string, unknown> = {}) => [
  event("ephemeris.probe", math, extra),
];

console.log("Availability tiles:");
await insight(
  id,
  "Probe results (up vs down)",
  trends(probeSeries(), [FLY_ONLY], breakdown("ok")),
  "One probe every 15 min. ok=false means /health did not answer, after a retry.",
);
await insight(
  id,
  "Failed probes",
  trends(probeSeries("total", { properties: [prop("ok", [false])] }), [FLY_ONLY]),
  "The outage tile. Any bar above zero is worth looking at.",
);
await insight(
  id,
  "Probe latency p95 (ms)",
  trends(probeSeries("p95", { math_property: "duration_ms" }), [FLY_ONLY]),
  "Dominated by cold starts by design: the probe is usually what wakes the machine.",
);
await insight(
  id,
  "Probe latency, median (ms)",
  trends(probeSeries("median", { math_property: "duration_ms" }), [FLY_ONLY]),
);
await insight(
  id,
  "Probes that cold-started the machine",
  trends(probeSeries(), [FLY_ONLY], { ...breakdown("cold_start"), ...bar }),
  "cold_start=true means the machine was stopped and this probe started it. " +
    "Expected to be most of them — that is scale-to-zero working, not a fault.",
);
await insight(
  id,
  "Probe retries",
  trends(probeSeries(), [FLY_ONLY], { ...breakdown("attempts"), ...bar }),
  "attempts=2 means the first connection failed and the retry saved it. " +
    "A rising count is an early warning that green runs are hiding flakiness.",
);

// --- Real traffic, from the app -------------------------------------------

const appSeries = (math = "total", extra: Record<string, unknown> = {}) => [
  event("api.request", math, extra),
];
const appProps = [FLY_ONLY, NOT_HEALTH];

console.log("Traffic tiles:");
await insight(
  id,
  "Request volume by route",
  trends(appSeries(), appProps, breakdown("function")),
  "Probe /health calls excluded — this is real callers only.",
);
await insight(
  id,
  "Status codes",
  trends(appSeries(), appProps, { ...breakdown("status"), ...table }),
);
await insight(
  id,
  "Latency p95 (ms) by route",
  trends(appSeries("p95", { math_property: "duration_ms" }), appProps, breakdown("function")),
);
await insight(
  id,
  "Errors by route",
  trends(
    appSeries("total", { properties: [prop("error", [true])] }),
    appProps,
    { ...breakdown("function"), ...table },
  ),
  "error=true is a 5xx. 4xx shows up under Status codes instead.",
);
await insight(
  id,
  "Real requests that paid a cold start",
  trends(
    appSeries("total", { properties: [prop("cold_start", [true])] }),
    appProps,
    breakdown("function"),
  ),
  "The tile that decides whether min_machines_running = 0 is costing anything. " +
    "Read it against total volume: if a real caller rarely hits a cold machine, " +
    "scale-to-zero is free. Note the probe suppresses this by keeping the machine " +
    "warmer than real traffic alone would.",
);
await insight(
  id,
  "Unauthorized requests (401)",
  trends(
    appSeries("total", { properties: [prop("status", ["401"])] }),
    appProps,
    { ...breakdown("function"), ...table },
  ),
  "A misconfigured caller, or the internet knocking. Either way it wakes the " +
    "machine and shows up on the bill.",
);
await insight(
  id,
  "Unknown paths (/other)",
  trends(
    appSeries("total", { properties: [prop("function", ["/other"])] }),
    [FLY_ONLY],
    { ...breakdown("method"), ...bar },
  ),
  "Everything that did not match a mounted route, collapsed to one bucket to " +
    "keep scanner noise out of the breakdowns.",
);

console.log(`\nDone. Open: ${HOST}/project/${PROJECT}/dashboard`);
