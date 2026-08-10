# ephemeris-api — agent guide

Swiss Ephemeris REST API (Express + `sweph`), deployed to Fly.io. Consumed by
the Supabase edge functions in `../amirlabs_app` and by the admin console at
`/admin/ephemeris` on amirlabs.app. Deploys on push to `main` via
`.github/workflows/fly-deploy.yml`.

The app runs **scale-to-zero** (`auto_stop_machines = 'stop'`,
`min_machines_running = 0`). A machine in `stopped` state is normal, not an
outage — Fly starts it on the next request, which costs roughly 1.5s. Do not
"fix" this by pinning a machine running unless asked.

## Rotating the API key

**Run `./scripts/rotate-key.sh`.** Do not rotate by hand — the key lives in
three services under two different names, and the manual sequence is how it
gets half-applied.

```sh
./scripts/rotate-key.sh --check    # verify auth and access, change nothing
./scripts/rotate-key.sh            # rotate, with a confirmation prompt
./scripts/rotate-key.sh --yes      # rotate unattended
```

Start with `--check`. If anything is missing it prints the exact command to fix
it (`flyctl auth login`, `supabase login`, `vercel login`, `vercel link`) and
exits non-zero without touching anything. Run the command it names, then retry.

Where the key lives — every one of these must hold the same value:

| Service | Name | Set by |
| --- | --- | --- |
| Fly app `ephemeris-api-wispy-wind-3393` | `API_KEY` | the script |
| Supabase project `heqkmuitjkehotsfzjxd` | `EPHEMERIS_API_KEY` | the script |
| Vercel project `amirlabs-app` (production + preview) | `EPHEMERIS_API_KEY` | the script |

Fly's `API_KEY` is what the API actually validates against; the others are
callers. The script updates callers first and Fly last, so the mismatch window
closes the moment Fly restarts. It then rebuilds the Vercel production
deployment: Vercel bakes env vars in at build time, so without that step the
live site keeps using the old key and `/admin/ephemeris` returns 401s.

**The key is deliberately not saved anywhere.** Every consumer is updated by the
script, so the value is never needed again — and a secret that is never written
down cannot leak. Do not add a step that stores it. If something new needs the
key, add it to the config block and re-run: rotating is cheaper than storing.

The one exception is a consumer that needs the key at *build* time rather than
from a CLI (a mobile binary, for example). That is what `--save` is for. There
are none today.

A partial failure is the one case that does write the key out, since finishing
by hand needs the value; the script tells you exactly which services took the
new key and which did not. Re-running from scratch is usually simpler than
finishing by hand.

Adding a new consumer? Add it to the config block at the top of
`scripts/rotate-key.sh`, the confirmation summary, the apply section, and the
table above.

## Other scripts

- `scripts/probe.mjs` — one uptime probe against `/health`, emits
  `ephemeris.probe` to PostHog. Run by `.github/workflows/uptime.yml` every 15
  minutes. Monitoring, **not** a keep-alive: Fly restarts a stopped machine on
  its own, so there is nothing to keep alive.
- `scripts/posthog_dashboard.ts` — recreates the PostHog dashboard
  (`deno run --allow-net --allow-env`). No upsert: delete the old dashboard
  first or you get a duplicate.

## Who calls this API

**Only Supabase edge functions and the amirlabs admin console.** No app talks
to this service directly, because doing so puts `API_KEY` inside a binary where
it is extractable and unreachable by `rotate-key.sh`. Numae reads charts
through the `natal-chart` edge function in `amirlabs_app`.

## The zodiac parameter

`/api/chart` takes an optional `zodiac` of `sidereal` or `tropical`.

- **Sidereal (Lahiri) is the default and must stay the default.** Every
  existing caller relies on it; flipping it would move every chart by the
  ayanamsha, currently ~24°, which is enough to change the Sun's sign.
- Tropical is the same calculation *without* the sidereal shift: no
  `SEFLG_SIDEREAL` on the bodies, and no ayanamsha subtracted from the
  ascendant or the Placidus cusps. Whole Sign derives its cusps from the
  ascendant's sign, so it follows whichever zodiac was computed.
- `ayanamsha` is returned in both modes — it is the only way a caller can tell
  which zodiac a stored response came from.
- The tests pin the *relationship*, not the numbers: the two modes differ by
  exactly the ayanamsha for both the Sun and the ascendant. Keep them that way,
  so they survive an ephemeris data update.

## Conventions

- `npm test` builds first, then runs `node --test` over `dist/`.
- Telemetry (`src/services/analytics.ts`) must never add latency to or fail a
  request, and must never carry request bodies or PII.
- `/health` is deliberately unauthenticated — the CI probe runs outside this
  app's trust boundary. Everything else is behind `requireApiKey`.
