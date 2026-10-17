#!/usr/bin/env bash
#
# Rotate the ephemeris API key across every service that holds it.
#
# The key is one shared secret under two names: `API_KEY` on Fly (the API
# validates against this one — it is the source of truth) and
# `EPHEMERIS_API_KEY` everywhere that calls the API. Rotating means changing
# all of them; changing only some breaks the callers that were missed.
#
# Usage:
#   ./scripts/rotate-key.sh                # preflight, confirm, rotate, verify
#   ./scripts/rotate-key.sh --check        # preflight only, change nothing
#   ./scripts/rotate-key.sh --yes          # skip the confirmation prompt
#   ./scripts/rotate-key.sh --save         # also keep a copy of the new key
#   ./scripts/rotate-key.sh --out FILE     # keep it, at this path (implies --save)
#   ./scripts/rotate-key.sh --print        # also echo the new key to stdout
#   ./scripts/rotate-key.sh --no-redeploy  # skip the Vercel rebuild
#
# The key never appears on a command line (visible to any `ps` on the box) and
# is never passed as an argument. It is written to a mode-600 temp file, fed to
# each CLI over stdin, and shredded on exit.
#
# On a clean run the key is NOT saved anywhere: every consumer is updated here,
# so the value is never needed again. To add a consumer, add it to the config
# block below and re-run — rotating beats storing. A partial failure is the one
# case that does write it out, because finishing by hand needs the value.

set -euo pipefail

# --------------------------------------------------------------------------
# Who holds this key. Update this block when a new consumer appears, and the
# rest of the script follows automatically.
# --------------------------------------------------------------------------

FLY_APP="ephemeris-api-wispy-wind-3393"
SUPABASE_PROJECT_REF="heqkmuitjkehotsfzjxd"   # the shared `amirlabs` project
VERCEL_PROJECT="amirlabs-app"
VERCEL_ENVIRONMENTS=("production" "preview")
HEALTH_URL="https://ephemeris-api-wispy-wind-3393.fly.dev/api/version"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
# Vercel and Supabase commands run from the amirlabs-web checkout, which is
# where both CLIs are linked.
AMIRLABS_DIR="${AMIRLABS_DIR:-$(dirname "$REPO_ROOT")/amirlabs-web}"

# Not updated, on purpose: legacy Numae's iOS app (amirlabs-apps/apps/legacy/numae) also sends this key
# (Utils/AstrologyService.swift reads `EphemerisAPIKey` from Info.plist, injected
# at build time). That app is retired and out of use — confirmed August 2026 — so
# it is deliberately left out. If it is ever revived, note that a shipped binary
# has the key compiled in and cannot be rotated: it would need a new build.
#
# If you add a consumer that CAN be updated, add it to the three blocks below
# (confirmation summary, apply section, and the docs in AGENTS.md).

# --------------------------------------------------------------------------

DO_CHECK_ONLY=0
ASSUME_YES=0
PRINT_KEY=0
SAVE_KEY=0
DO_REDEPLOY=1
OUT_FILE="$HOME/ephemeris-api-key-$(date -u +%Y%m%d-%H%M%S).txt"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) DO_CHECK_ONLY=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --print) PRINT_KEY=1 ;;
    --save) SAVE_KEY=1 ;;
    --no-redeploy) DO_REDEPLOY=0 ;;
    --out) OUT_FILE="$2"; SAVE_KEY=1; shift ;;
    # Prints the header comment, stopping at the first non-comment line, so it
    # stays correct however long that block grows.
    -h|--help)
      awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }
info() { printf '  %s\n' "$*"; }

# --------------------------------------------------------------------------
# Preflight. Every failure is collected so one run tells you everything that
# needs fixing, each with the exact command that fixes it.
# --------------------------------------------------------------------------

PROBLEMS=()

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    bad "$1 not installed"
    PROBLEMS+=("Install $1:  $2")
    return 1
  fi
  ok "$1 installed"
}

bold "Checking tools"
need_cmd openssl "comes with macOS; try 'brew install openssl'" || true
need_cmd curl    "comes with macOS" || true
need_cmd flyctl  "brew install flyctl" || true
need_cmd supabase "brew install supabase/tap/supabase" || true
need_cmd vercel  "npm i -g vercel" || true

echo
bold "Checking authentication"

if command -v flyctl >/dev/null 2>&1; then
  if flyctl auth whoami >/dev/null 2>&1; then
    ok "Fly authenticated"
  else
    bad "Fly not authenticated"
    PROBLEMS+=("Authenticate with Fly:  flyctl auth login")
  fi
fi

if command -v supabase >/dev/null 2>&1; then
  if supabase projects list >/dev/null 2>&1; then
    ok "Supabase authenticated"
  else
    bad "Supabase not authenticated"
    PROBLEMS+=("Authenticate with Supabase:  supabase login")
  fi
fi

if command -v vercel >/dev/null 2>&1; then
  if vercel whoami >/dev/null 2>&1; then
    ok "Vercel authenticated"
  else
    bad "Vercel not authenticated"
    PROBLEMS+=("Authenticate with Vercel:  vercel login")
  fi
fi

echo
bold "Checking project access"

if [[ ! -d "$AMIRLABS_DIR" ]]; then
  bad "amirlabs-web checkout not found at $AMIRLABS_DIR"
  PROBLEMS+=("Clone it beside this repo, or set AMIRLABS_DIR=/path/to/amirlabs-web")
else
  ok "amirlabs-web at $AMIRLABS_DIR"
  # Probe the CLI rather than looking for a link file: `vercel link` writes
  # .vercel/project.json for a plain link but .vercel/repo.json when the project
  # is linked through its git repo, and only the CLI knows which counts.
  if command -v vercel >/dev/null 2>&1 && vercel whoami >/dev/null 2>&1; then
    if vercel env ls --cwd "$AMIRLABS_DIR" >/dev/null 2>&1; then
      ok "Vercel project linked and readable"
    else
      bad "amirlabs-web is not linked to a Vercel project"
      PROBLEMS+=("Link it:  cd $AMIRLABS_DIR && vercel link")
    fi
  fi
fi

if command -v flyctl >/dev/null 2>&1 && flyctl auth whoami >/dev/null 2>&1; then
  if flyctl status --app "$FLY_APP" >/dev/null 2>&1; then
    ok "Fly app $FLY_APP reachable"
  else
    bad "Cannot reach Fly app $FLY_APP"
    PROBLEMS+=("Check the app name:  flyctl apps list")
  fi
fi

if [[ ${#PROBLEMS[@]} -gt 0 ]]; then
  echo
  bold "Fix these, then run this script again:"
  for p in "${PROBLEMS[@]}"; do printf '  → %s\n' "$p"; done
  exit 1
fi

echo
ok "All preflight checks passed."

if [[ $DO_CHECK_ONLY -eq 1 ]]; then
  echo
  info "--check given; nothing was changed."
  exit 0
fi

# --------------------------------------------------------------------------
# Confirm
# --------------------------------------------------------------------------

echo
bold "This will rotate the ephemeris API key in:"
info "• Fly       $FLY_APP                 secret API_KEY"
info "• Supabase  $SUPABASE_PROJECT_REF    secret EPHEMERIS_API_KEY"
info "• Vercel    amirlabs-app             env EPHEMERIS_API_KEY (${VERCEL_ENVIRONMENTS[*]})"
echo
info "Callers briefly see 401s: Supabase and Vercel get the new key first, then"
info "Fly switches over last, so the window closes the moment Fly restarts."

if [[ $ASSUME_YES -ne 1 ]]; then
  echo
  read -r -p "Proceed? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

# --------------------------------------------------------------------------
# Generate. umask first so the file is never briefly world-readable.
# --------------------------------------------------------------------------

umask 077
TMPDIR_ROT="$(mktemp -d)"
cleanup() { rm -rf "$TMPDIR_ROT"; }
trap cleanup EXIT

KEY_FILE="$TMPDIR_ROT/key"          # bare value
FLY_ENV="$TMPDIR_ROT/fly.env"       # API_KEY=...
EPH_ENV="$TMPDIR_ROT/eph.env"       # EPHEMERIS_API_KEY=...

openssl rand -hex 32 | tr -d '\n' > "$KEY_FILE"
{ printf 'API_KEY='; cat "$KEY_FILE"; printf '\n'; } > "$FLY_ENV"
{ printf 'EPHEMERIS_API_KEY='; cat "$KEY_FILE"; printf '\n'; } > "$EPH_ENV"

echo
bold "Generated a new 32-byte key."

# Track what actually landed, so a mid-way failure reports the real state
# rather than leaving you guessing which stores are out of sync.
APPLIED=()
report_state() {
  echo
  bold "State right now:"
  if [[ ${#APPLIED[@]} -eq 0 ]]; then
    info "Nothing was changed. The old key is still in effect everywhere."
  else
    for a in "${APPLIED[@]}"; do info "• $a has the NEW key"; done
    info "Everything else still has the OLD key — these are OUT OF SYNC."
    # Only a partial rotation needs the value: you may have to finish by hand,
    # and no service will show it back to you. A clean run never writes it out.
    cp "$KEY_FILE" "$OUT_FILE" 2>/dev/null && chmod 600 "$OUT_FILE" 2>/dev/null || true
    info "The new key is saved at: $OUT_FILE"
    info "Finish by hand, or just re-run this script to rotate cleanly again."
  fi
}
trap 'report_state; cleanup' ERR

# --------------------------------------------------------------------------
# Apply — consumers first, Fly last.
# --------------------------------------------------------------------------

echo
bold "Updating Supabase"
# Run from the amirlabs-web checkout: the Supabase CLI drops a `supabase/.temp`
# scaffold into whatever directory it runs in, and that repo is where it belongs
# (and is already gitignored there). Running it from here litters this repo.
( cd "$AMIRLABS_DIR" && supabase secrets set --env-file "$EPH_ENV" --project-ref "$SUPABASE_PROJECT_REF" >/dev/null )
APPLIED+=("Supabase ($SUPABASE_PROJECT_REF)")
ok "EPHEMERIS_API_KEY set"

echo
bold "Updating Vercel"
for env_name in "${VERCEL_ENVIRONMENTS[@]}"; do
  # `vercel env add` refuses to overwrite, so remove first. The remove fails
  # harmlessly the very first time, when there is nothing to remove.
  vercel env rm EPHEMERIS_API_KEY "$env_name" --yes --cwd "$AMIRLABS_DIR" >/dev/null 2>&1 || true
  # stdout only — stderr stays visible so a failure explains itself.
  vercel env add EPHEMERIS_API_KEY "$env_name" --cwd "$AMIRLABS_DIR" < "$KEY_FILE" >/dev/null
  ok "EPHEMERIS_API_KEY set for $env_name"
done
APPLIED+=("Vercel (${VERCEL_ENVIRONMENTS[*]})")

echo
bold "Updating Fly (restarts the app)"
flyctl secrets import --app "$FLY_APP" < "$FLY_ENV" >/dev/null
APPLIED+=("Fly ($FLY_APP)")
ok "API_KEY set"

# --------------------------------------------------------------------------
# Vercel bakes env vars into a deployment at build time, so the running
# production build still holds the OLD key until it is rebuilt. Skipping this
# leaves /admin/ephemeris getting 401s from an otherwise-correct rotation.
#
# Deliberately non-fatal: the rotation itself has already succeeded by this
# point, and a convenience redeploy must never be what makes it look failed.
# --------------------------------------------------------------------------

echo
bold "Redeploying Vercel so the new key takes effect"
if [[ $DO_REDEPLOY -ne 1 ]]; then
  info "Skipped (--no-redeploy). Production keeps the OLD key until you rebuild."
elif ! command -v jq >/dev/null 2>&1; then
  bad "jq not installed, cannot find the deployment to rebuild"
  info "Redeploy by hand:  vercel redeploy <latest-production-url> --target production"
else
  latest_url="$(vercel ls "$VERCEL_PROJECT" --format json --cwd "$AMIRLABS_DIR" 2>/dev/null \
    | jq -r '[.deployments[] | select(.target=="production" and .state=="READY")]
             | sort_by(.createdAt) | last | .url' 2>/dev/null || true)"
  if [[ -z "$latest_url" || "$latest_url" == "null" ]]; then
    bad "Could not determine the latest production deployment"
    info "Redeploy by hand:  vercel redeploy <latest-production-url> --target production"
  else
    # Rebuilds that deployment's own git source, so uncommitted local files are
    # never what ships.
    if vercel redeploy "https://$latest_url" --target production --cwd "$AMIRLABS_DIR" >/dev/null 2>&1; then
      ok "Production rebuilt with the new key"
    else
      bad "Redeploy failed — the key rotation itself still succeeded"
      info "Retry by hand:  vercel redeploy https://$latest_url --target production"
    fi
  fi
fi

# --------------------------------------------------------------------------
# Verify against the live API — the only check that proves the rotation took.
# --------------------------------------------------------------------------

trap 'cleanup' ERR   # past the danger zone; failures below are diagnostic

echo
bold "Verifying"

# Passed via a curl config file, not -H, so the key never lands in argv where
# any `ps` on the machine could read it — the same rule the rest of this script
# follows.
CURL_CFG="$TMPDIR_ROT/curlrc"
{
  printf 'url = "%s"\n' "$HEALTH_URL"
  printf 'header = "x-api-key: '
  tr -d '\n' < "$KEY_FILE"
  printf '"\n'
} > "$CURL_CFG"

status_with_key="$(curl -s -o /dev/null -w '%{http_code}' --config "$CURL_CFG" || echo 000)"
status_no_key="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || echo 000)"

if [[ "$status_with_key" == "200" ]]; then
  ok "New key accepted by the API (200)"
else
  bad "New key returned $status_with_key, expected 200"
  info "Fly may still be restarting. Wait a few seconds, then re-run:"
  info "  $0 --check   (and see $OUT_FILE for the key)"
fi

if [[ "$status_no_key" == "401" ]]; then
  ok "Unauthenticated requests still rejected (401)"
else
  bad "Expected 401 without a key, got $status_no_key"
fi

# --------------------------------------------------------------------------
# Hand the key over. Losing it means rotating again, so make saving it easy.
# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# The key is deliberately NOT saved anywhere on a clean run.
#
# Every consumer is updated by this script, so the value is never needed again:
# to add a consumer, add it to the config block above and re-run. Rotating is
# cheaper than storing, and a secret you never write down cannot leak from a
# notes app, a shell history, or a stray file in $HOME.
#
# The exception is a consumer that needs the key at *build* time rather than
# from a CLI — a mobile binary, say. If you ever add one, use --save and put the
# value somewhere real.
# --------------------------------------------------------------------------

if [[ $SAVE_KEY -eq 1 ]]; then
  cp "$KEY_FILE" "$OUT_FILE"
  chmod 600 "$OUT_FILE"
  echo
  bold "Key saved"
  info "At: $OUT_FILE  (mode 600). Nothing can show it back to you — store it, then:"
  info "  rm -f $OUT_FILE"
  if command -v pbcopy >/dev/null 2>&1; then
    pbcopy < "$KEY_FILE"
    ok "Also copied to your clipboard"
  fi
fi

if [[ $PRINT_KEY -eq 1 ]]; then
  echo
  info "New key: $(cat "$KEY_FILE")"
fi

echo
bold "Done"
if [[ $SAVE_KEY -ne 1 ]]; then
  info "The key was not written anywhere — every consumer already has it."
  info "Need it somewhere new? Add it to the config block at the top and re-run."
fi
info "Supabase→Fly is not covered by the check above. Exercise it from the admin"
info "panel: /admin/ordibehesht-equinox → \"Sync equinoxes\"."
