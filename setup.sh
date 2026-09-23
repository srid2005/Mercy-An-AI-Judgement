#!/usr/bin/env bash
#
# setup.sh -- deploy "MERCY: AI Judgement" on a Google Compute Engine VM.
#
#   ./setup.sh                       # install, configure, build, start, verify
#   ./setup.sh --stage=preflight     # read-only: can this VM run the event?
#   ./setup.sh --stage=verify        # read-only: is the event healthy right now?
#
# Target: a fresh Ubuntu 24.04 LTS GCE VM (e2-standard-4), run by a normal
# sudo-capable user. Works as root too. Safe to re-run: it never drops a
# database, never rotates a secret that is already in .env, and never calls the
# admin API's destructive endpoints -- where a reset is the right answer it
# prints the command and lets a human decide.
#
# Three things about this stack drive most of what follows:
#
#   1. mercy-lobby mounts the Docker socket and lists the stack by the label
#      com.docker.compose.project=mercy-aijudgement (hardcoded as
#      COMPOSE_PROJECT in docker-compose.yml). Compose takes the project name
#      from the DIRECTORY name, so a clone into any other directory leaves the
#      admin panel's Resources page empty and its "Restart services" button a
#      silent no-op that still answers 200. Hence COMPOSE_PROJECT_NAME below,
#      and the label assertion in the verify stage.
#
#   2. Only the seven Postgres containers have compose healthchecks. None of
#      the nine built services does, and mercy-engine depends on its peers with
#      service_started. So "docker compose up -d returned" is not evidence that
#      anything serves. Everything here waits on real HTTP.
#
#   3. Nothing in the engine reports whether Vertex AI is actually answering.
#      It logs the configured provider once at boot -- a statement about .env,
#      not about reachability -- and on failure falls back to canned replies
#      with one line in the log. So this script proves Vertex out of band,
#      against the API itself, before the event rather than during it.

set -Eeuo pipefail

# ---------------------------------------------------------------------------
# What the stack is. The preflight stage checks these against
# docker-compose.yml, so an edit there shows up as a FAIL, not a surprise.
# ---------------------------------------------------------------------------

# Do not change without changing COMPOSE_PROJECT in docker-compose.yml to match.
readonly PROJECT_NAME='mercy-aijudgement'

# 7 postgres:16-alpine + 9 built services.
readonly EXPECTED_CONTAINERS=16

# The nine published ports and how to prove each is really serving.
#   port|kind|marker|service|description
# json -> GET /api/health must contain "service":"<marker>"
# html -> GET / must contain <marker>. Both nginx services use
#         try_files $uri $uri/ /index.html, so EVERY path returns 200 and a
#         status-code check would pass against an empty document root.
readonly -a PROBES=(
  '3030|json|mercy-lobby|mercy-lobby|lobby: login, admin, leaderboard'
  '4001|json|social-media|social-media|Loop'
  '4002|json|email|email|Quill'
  '4003|json|whatsapp|whatsapp|Wisp'
  '4008|json|haven|haven|Haven'
  '4010|json|mercy-engine|mercy-engine|MERCY engine'
  '4011|json|city-map|city-map|city map'
  '3000|html|MEERA-LAPTOP|desktop-shell|the laptop (nginx)'
  '3020|html|<title>MERCY</title>|mercy-console|console (nginx)'
)

# For the printed gcloud rule. gcloud --allow needs the protocol on EVERY
# element: "tcp:3000,3020" parses 3020 as a protocol name and the rule is wrong.
readonly FIREWALL_PORTS='tcp:3000,tcp:3020,tcp:3030,tcp:4001,tcp:4002,tcp:4003,tcp:4008,tcp:4010,tcp:4011'

# Bind-mounted at first boot. A checkout missing one of these builds fine and
# then comes up with an empty database.
readonly -a REQUIRED_PATHS=(
  'docker-compose.yml'
  '.env.example'
  'services/social-media/db/init.sql'
  'services/whatsapp/db/init.sql'
  'services/email/db/init.sql'
  'services/haven/db/init.sql'
  'services/city-map/db/01_schema.sql'
  'services/city-map/db/02_city.sql'
  'services/city-map/db/03_story.sql'
  'services/city-map/db/04_vehicles.sql'
  'services/mercy-engine/db/init.sql'
  'services/mercy-lobby/db/init.sql'
)

# Story media that is NOT tracked in git. A clone-based deploy loses these
# silently: the build succeeds, the stack boots, and a participant meets a 404
# at the one moment the game turns on it.
readonly -a MEDIA_PATHS=(
  'services/city-map/public/video/rescue.mp4'
  'services/city-map/public/audio/SW-06-band-memo.mp3'
  'services/desktop-shell/public/files/docs'
  'services/desktop-shell/public/files/photos'
  'services/desktop-shell/public/img/wallpaper/meera'
  'services/haven/public/videos'
  'services/email/public/images/attachments'
)

# llm/index.js throws at require time on anything else, and restart:
# unless-stopped then loops mercy-engine forever.
readonly -a VALID_PROVIDERS=('stub' 'vertex' 'anthropic')

readonly METADATA='http://169.254.169.254/computeMetadata/v1'
readonly MD_HDR='Metadata-Flavor: Google'

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

REPO_DIR=''
ADMIN_PASSWORD="${MERCY_ADMIN_PASSWORD:-}"
ADMIN_PASSWORD_FILE=''
ADMIN_PASSWORD_SOURCE=''
GENERATED_PASSWORD_FILE=''
FORCE_PASSWORD=0
GAME_MINUTES='60'
LLM_PROVIDER='vertex'
GCP_PROJECT='zinnia-mercy'
GCP_LOCATION='global'
VERTEX_MODEL='gemini-2.5-flash'
STAGES='all'
ASSUME_YES=0
FORCE=0                  # carry on past preflight failures that would normally stop
DO_BUILD='auto'          # auto | always | never
RECREATE=0
READY_TIMEOUT=900
USE_COLOR='auto'
LOG_FILE=''
ROTATE_KEYS='auto'       # auto = only when the key is not already in .env
BUILT=0                  # did stage_build actually build? stage_start asks.
PROVIDER_SET=0           # did the operator actually pass the flag, or is this
PROJECT_SET=0            # just the default? A default must not override .env,
LOCATION_SET=0           # or preflight and verify would check the deployment
MODEL_SET=0              # the operator asked for rather than the one running.
MINUTES_SET=0
SINGLE_PLAYER='0'

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

SUDO=()
DOCKER=()
COMPOSE=()
HAVE_JQ=0
NEEDS_RELOGIN=0
FAILURES=0
WARNINGS=0
PREFLIGHT_FATAL=0        # failures that make everything after them pointless
EXTERNAL_IP=''
ENV_BACKUP=''
declare -a ROWS=()
declare -a REMEDIES=()

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

C_OFF='' C_BOLD='' C_DIM='' C_RED='' C_GRN='' C_YEL='' C_CYN=''

setup_colors() {
  local want=0
  case "$USE_COLOR" in
    always) want=1 ;;
    never)  want=0 ;;
    *)      if [[ -t 1 && -z ${NO_COLOR:-} && ${TERM:-dumb} != 'dumb' ]]; then want=1; fi ;;
  esac
  if (( want )); then
    C_OFF=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
    C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_CYN=$'\033[36m'
  fi
}

info() { printf '      %s%s%s\n' "$C_DIM" "$*" "$C_OFF"; }
ok()   { ROWS+=("PASS|$1|${2:-}"); printf '  %sok%s    %s%s\n' "$C_GRN" "$C_OFF" "$1" "${2:+  -- $2}"; }
warn() { WARNINGS=$(( WARNINGS + 1 )); ROWS+=("WARN|$1|${2:-}"); printf '  %swarn%s  %s%s\n' "$C_YEL" "$C_OFF" "$1" "${2:+  -- $2}"; }
bad()  { FAILURES=$(( FAILURES + 1 )); ROWS+=("FAIL|$1|${2:-}"); printf '  %sfail%s  %s%s\n' "$C_RED" "$C_OFF" "$1" "${2:+  -- $2}"; }
remedy() { REMEDIES+=("$1"); }
# bad(), but for a condition where continuing only wastes the operator's time:
# no disk, wrong architecture, a checkout with no seed SQL in it. Vertex, the
# firewall and the scopes are NOT fatal -- the stack builds and runs without
# them, and they are fixable while it builds.
fatal() { PREFLIGHT_FATAL=$(( PREFLIGHT_FATAL + 1 )); bad "$@"; }

step() { printf '\n%s%s==>%s %s%s%s\n' "$C_BOLD" "$C_CYN" "$C_OFF" "$C_BOLD" "$*" "$C_OFF"; }

die() { printf '\n%sfatal%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }

on_err() {
  local code=$? line=$1
  printf '\n%s%sSetup stopped.%s\n' "$C_BOLD" "$C_RED" "$C_OFF" >&2
  printf '  line %s exited %s while running:\n    %s\n\n' "$line" "$code" "$BASH_COMMAND" >&2
  printf '  Re-running this script is safe. The usual causes are no outbound\n' >&2
  printf '  internet (the build pulls Docker Hub and npm), a half-installed\n' >&2
  printf '  docker, or a checkout missing files.\n' >&2
  if [[ -n $LOG_FILE ]]; then printf '  Full transcript: %s\n' "$LOG_FILE" >&2; fi
  exit "$code"
}
trap 'on_err "$LINENO"' ERR

usage() {
  cat <<'USAGE_EOF'
MERCY: AI Judgement -- deployment for a Google Compute Engine VM.

USAGE
  ./setup.sh [options]

STAGES                      (default: all, in this order)
  --stage=preflight         read-only: can this VM run the event?
  --stage=install           docker engine + compose plugin + git + jq
  --stage=configure         write .env (secrets, admin password, Vertex)
  --stage=build             build the nine images
  --stage=start             bring the stack up and wait for it to serve
  --stage=verify            read-only: is the event healthy right now?
  --stage=install,configure comma-separated combinations are fine

THE ADMIN PASSWORD          (never accepted on the command line -- argv is
                             world readable in /proc)
  --admin-password-file F   read it from F (first line)
  MERCY_ADMIN_PASSWORD=...  or from the environment
  --force-password          replace the one already in .env
  --force                   carry on even when preflight found something that
                            would normally stop the run (no disk, no seed SQL)
  --yes                     non-interactive: generate one and write it to
                            ./admin-password.txt (mode 600) if none was given

THE EVENT
  --minutes N               GAME_MINUTES (default 60)
  --provider P              stub | vertex | anthropic (default vertex)
  --gcp-project ID          GOOGLE_CLOUD_PROJECT (default zinnia-mercy)
  --gcp-location L          GOOGLE_CLOUD_LOCATION (default global)
  --model M                 VERTEX_MODEL (default gemini-2.5-flash)
  --rotate-keys             regenerate INTERNAL_API_KEY / MERCY_API_KEY /
                            JWT_SECRET even though .env already has them.
                            MERCY_SESSION_SECRET is deliberately NOT rotated:
                            it signs every participant cookie, and changing it
                            logs the whole room out at once.

BUILD AND RUN
  --no-build                use the images that already exist (event morning)
  --rebuild                 force a rebuild even if images exist
  --recreate                recreate containers even if nothing changed
  --timeout SECONDS         how long to wait for the stack to serve (900)

OTHER
  --dir PATH                the checkout to deploy (default: this script's dir)
  --log FILE                transcript (default ./setup-YYYY-mm-dd-HHMM.log)
  --color always|never|auto
  -h, --help

EXAMPLES
  ./setup.sh --stage=preflight                     # the day before, read-only
  ./setup.sh --admin-password-file ~/.mercy-admin  # the real deployment
  ./setup.sh --stage=verify                        # 8:40am, is it healthy?
  ./setup.sh --stage=start --no-build --recreate   # restart without rebuilding
USAGE_EOF
}

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

parse_args() {
  while (( $# )); do
    # Each of these dereferences $2. Under set -u a flag left last on the
    # command line aborts with "$2: unbound variable" before the ERR trap,
    # before usage(), before anything can explain what went wrong.
    case "$1" in
      --stage|--admin-password-file|--minutes|--provider|--gcp-project|--gcp-location|--model|--timeout|--dir|--log|--color)
        if (( $# < 2 )); then usage >&2; die "$1 needs a value"; fi ;;
    esac
    case "$1" in
      --stage)                  STAGES="$2"; shift ;;
      --stage=*)                STAGES="${1#*=}" ;;
      --admin-password-file)    ADMIN_PASSWORD_FILE="$2"; shift ;;
      --admin-password-file=*)  ADMIN_PASSWORD_FILE="${1#*=}" ;;
      --admin-password|--admin-password=*)
        die "--admin-password is not accepted: the command line is visible to every user on the VM through /proc. Use --admin-password-file, the MERCY_ADMIN_PASSWORD environment variable, or let the prompt ask." ;;
      --force-password)         FORCE_PASSWORD=1 ;;
      --minutes)                GAME_MINUTES="$2"; MINUTES_SET=1; shift ;;
      --minutes=*)              GAME_MINUTES="${1#*=}"; MINUTES_SET=1 ;;
      --provider)               LLM_PROVIDER="$2"; PROVIDER_SET=1; shift ;;
      --provider=*)             LLM_PROVIDER="${1#*=}"; PROVIDER_SET=1 ;;
      --gcp-project)            GCP_PROJECT="$2"; PROJECT_SET=1; shift ;;
      --gcp-project=*)          GCP_PROJECT="${1#*=}"; PROJECT_SET=1 ;;
      --gcp-location)           GCP_LOCATION="$2"; LOCATION_SET=1; shift ;;
      --gcp-location=*)         GCP_LOCATION="${1#*=}"; LOCATION_SET=1 ;;
      --model)                  VERTEX_MODEL="$2"; MODEL_SET=1; shift ;;
      --model=*)                VERTEX_MODEL="${1#*=}"; MODEL_SET=1 ;;
      --rotate-keys)            ROTATE_KEYS='always' ;;
      --no-build)               DO_BUILD='never' ;;
      --rebuild)                DO_BUILD='always' ;;
      --recreate)               RECREATE=1 ;;
      --timeout)                READY_TIMEOUT="$2"; shift ;;
      --timeout=*)              READY_TIMEOUT="${1#*=}" ;;
      --dir)                    REPO_DIR="$2"; shift ;;
      --dir=*)                  REPO_DIR="${1#*=}" ;;
      --log)                    LOG_FILE="$2"; shift ;;
      --log=*)                  LOG_FILE="${1#*=}" ;;
      --color)                  USE_COLOR="$2"; shift ;;
      --color=*)                USE_COLOR="${1#*=}" ;;
      -y|--yes)                 ASSUME_YES=1 ;;
      --force)                  FORCE=1 ;;
      -h|--help)                usage; exit 0 ;;
      *)                        usage >&2; die "unknown option: $1" ;;
    esac
    shift
  done

  validate_provider 'the --provider flag'

  if [[ ! $GAME_MINUTES =~ ^[0-9]+$ ]];  then die "--minutes must be a whole number"; fi
  if [[ ! $READY_TIMEOUT =~ ^[0-9]+$ ]]; then die "--timeout must be a whole number of seconds"; fi

  # wants() answers "no" to a name it does not know, so an invented stage runs
  # nothing at all and exits 0 -- a deployment that looks like it worked.
  if [[ $STAGES != 'all' ]]; then
    local st
    local -a asked=()
    IFS=',' read -r -a asked <<<"$STAGES"
    if (( ! ${#asked[@]} )); then die "--stage needs at least one stage name"; fi
    for st in "${asked[@]}"; do
      case "${st// /}" in
        preflight|install|configure|build|start|verify) ;;
        '') die "--stage has an empty element: '$STAGES'" ;;
        *)  die "unknown stage '${st// /}'. Known stages: preflight, install, configure, build, start, verify" ;;
      esac
    done
  fi
}

# An illegal provider is not a typo the stack shrugs off: llm/index.js throws
# at require time and restart:unless-stopped loops mercy-engine for ever. This
# runs against the flag AND again after .env is adopted, because .env is where
# a hand-edit lands.
validate_provider() {
  local p valid=0
  for p in "${VALID_PROVIDERS[@]}"; do
    if [[ $LLM_PROVIDER == "$p" ]]; then valid=1; fi
  done
  if (( ! valid )); then
    die "MERCY_LLM_PROVIDER is '$LLM_PROVIDER' (from $1). It must be one of: ${VALID_PROVIDERS[*]} -- anything else makes mercy-engine throw at startup and restart for ever."
  fi
}

# Is stage "$1" selected?
wants() {
  if [[ $STAGES == 'all' ]]; then return 0; fi
  local s
  local -a want=()
  IFS=',' read -r -a want <<<"$STAGES"
  for s in "${want[@]}"; do
    if [[ ${s// /} == "$1" ]]; then return 0; fi
  done
  return 1
}

confirm() {
  if (( ASSUME_YES )); then return 0; fi
  if [[ ! -t 0 ]]; then return 1; fi
  local reply=''
  read -r -p "  $1 [y/N] " reply || return 1
  [[ $reply == [yY]* ]]
}

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

have() { command -v "$1" >/dev/null 2>&1; }

as_root() {
  if (( ${#SUDO[@]} )); then "${SUDO[@]}" "$@"; else "$@"; fi
}

# Every apt call goes through here.
#   DPkg::Lock::Timeout   -- a freshly booted GCE VM is still running
#                            unattended-upgrades and apt-daily; without this the
#                            first apt-get dies on "Could not get lock". This is
#                            the single most likely real-world failure.
#   NEEDRESTART_MODE=a    -- installing docker-ce restarts services, and on
#                            24.04 needrestart's "which services?" dialog is NOT
#                            suppressed by DEBIAN_FRONTEND alone: the run hangs
#                            with no output.
#   env ... as_root       -- sudo's default policy is env_reset and neither
#                            variable is in env_keep, so exporting them in this
#                            shell would not survive into the sudo'd apt.
apt_get() {
  as_root env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a \
    apt-get -o DPkg::Lock::Timeout=300 "$@"
}

# Read one field out of a JSON blob. jq when we have it; python3 (always on an
# Ubuntu server image) otherwise. Returns empty and succeeds when absent, so
# callers can assign under set -e.
json_get() {
  local blob="$1" field="$2"
  if (( HAVE_JQ )); then
    printf '%s' "$blob" | jq -r --arg f "$field" '.[$f] // empty' 2>/dev/null || true
  elif have python3; then
    printf '%s' "$blob" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get(sys.argv[1], "") or "")
except Exception:
    pass' "$field" 2>/dev/null || true
  else
    printf '%s' "$blob" | grep -o "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
      | head -n1 | sed 's/.*:[[:space:]]*"//; s/"$//' || true
  fi
}

metadata() {
  curl -sS --max-time 5 -H "$MD_HDR" "$METADATA/$1" 2>/dev/null || true
}

on_gce() {
  curl -sS --max-time 3 -o /dev/null -H "$MD_HDR" "$METADATA/instance/id" 2>/dev/null
}

# GET a URL and print "<http-code>\n<body>". Never fails the script.
http_get() {
  curl -sS --max-time "${2:-8}" -w $'\n%{http_code}' "$1" 2>/dev/null || printf '\n000'
}

# A secret with no characters that Compose would interpolate out of .env.
gen_secret() {
  local n="${1:-32}"
  openssl rand -hex "$n" 2>/dev/null || head -c "$n" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# A password a human has to read off a screen and type at the admin desk.
# Deliberately alphanumeric: Compose interpolates ${...} inside .env values, so
# a '$' in the password reaches mercy-lobby mangled and the desk cannot log in.
gen_password() {
  LC_ALL=C tr -dc 'A-HJ-NP-Za-km-z2-9' </dev/urandom 2>/dev/null | head -c 20 || true
}

# ---------------------------------------------------------------------------
# Becoming able to run docker
# ---------------------------------------------------------------------------

resolve_sudo() {
  if [[ $(id -u) -eq 0 ]]; then
    SUDO=()
  elif have sudo; then
    SUDO=(sudo -n)
    if ! sudo -n true 2>/dev/null; then
      SUDO=(sudo)
      info "sudo will ask for your password"
    fi
  elif wants 'install'; then
    die "installing Docker needs root: install sudo, or run the script as root"
  else
    # preflight and verify only read things, so an unprivileged user is fine
    SUDO=()
  fi
}

# Adding yourself to the docker group does not change the CURRENT shell's
# groups -- and newgrp starts an interactive subshell, which would hang a
# non-interactive run. Run docker through "sudo -u <me> -g docker" instead:
# same user, docker as the primary group, no re-login needed for THIS run.
# (-g without -u would run as root, which is a different thing entirely.)
resolve_docker() {
  if ! have docker; then DOCKER=(); return 0; fi
  if docker version >/dev/null 2>&1; then
    DOCKER=(docker)
  elif have sudo && sudo -n -u "$(id -un)" -g docker -- docker version >/dev/null 2>&1; then
    DOCKER=(sudo -u "$(id -un)" -g docker --)
    DOCKER+=(docker)
    NEEDS_RELOGIN=1
  elif as_root docker version >/dev/null 2>&1; then
    DOCKER=("${SUDO[@]}" docker)
    NEEDS_RELOGIN=1
  else
    DOCKER=()
    return 0
  fi

  # Always name the project and the directory explicitly. The compose file has
  # relative bind mounts, so a run from anywhere else would resolve them
  # against the wrong root -- and the project name is load-bearing (see the
  # header). This makes both independent of the caller's cwd.
  COMPOSE=("${DOCKER[@]}" compose
           --project-name "$PROJECT_NAME"
           --project-directory "$REPO_DIR"
           --file "$REPO_DIR/docker-compose.yml")
}

# ---------------------------------------------------------------------------
# Stage: preflight -- read-only. Nothing here changes the VM.
# ---------------------------------------------------------------------------

stage_preflight() {
  step "Preflight -- can this VM run the event?"

  # --- the machine ---------------------------------------------------------
  local arch; arch="$(uname -m)"
  if [[ $arch == 'x86_64' ]]; then
    ok "architecture" "$arch"
  else
    fatal "architecture" "$arch -- every base image here is amd64 only"
    remedy "Recreate the VM with an x86_64 machine type (e2-standard-4)."
  fi

  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    local pretty; pretty="$(. /etc/os-release && printf '%s' "${PRETTY_NAME:-unknown}")"
    case "$pretty" in
      *'24.04'*|*'22.04'*) ok "operating system" "$pretty" ;;
      *) warn "operating system" "$pretty -- written for Ubuntu 24.04 LTS; the apt steps may differ" ;;
    esac
  fi

  local cores; cores="$(nproc 2>/dev/null || printf '0')"
  if   (( cores >= 4 )); then ok   "cpu" "$cores vCPU"
  elif (( cores >= 2 )); then warn "cpu" "$cores vCPU -- the nine images build in parallel; expect a slow first build"
  else fatal "cpu" "$cores vCPU"; fi

  local mem_kb mem_gb
  mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || printf '0')"
  mem_gb=$(( mem_kb / 1024 / 1024 ))
  # The real peak is concurrency: seven npm installs, one vite build and two
  # nginx copies at once, roughly 2-3 GB. No single image is memory hungry.
  if   (( mem_gb >= 8 )); then ok   "memory" "${mem_gb} GB"
  elif (( mem_gb >= 4 )); then warn "memory" "${mem_gb} GB -- the parallel build peaks near 3 GB; build with --rebuild well before the event, or add swap"
  else fatal "memory" "${mem_gb} GB -- too little to build the stack"; fi

  # Free space where Docker actually stores images, not where we guess it does.
  local root_dir='/var/lib/docker' avail_kb avail_gb
  if (( ${#DOCKER[@]} )); then
    root_dir="$("${DOCKER[@]}" info -f '{{.DockerRootDir}}' 2>/dev/null || printf '/var/lib/docker')"
  fi
  local probe="$root_dir"
  while [[ -n $probe && ! -d $probe ]]; do probe="$(dirname "$probe")"; done
  avail_kb="$(df -Pk "${probe:-/}" 2>/dev/null | awk 'NR==2 {print $4}' || printf '0')"
  avail_gb=$(( avail_kb / 1024 / 1024 ))
  # ~550 MB of build context, nine images, seven postgres volumes, plus the
  # build cache. 12 GB free is comfortable; under 8 GB the build can wedge.
  if   (( avail_gb >= 12 )); then ok   "disk" "${avail_gb} GB free on $root_dir"
  elif (( avail_gb >= 8 ));  then warn "disk" "${avail_gb} GB free on $root_dir -- tight; docker system prune -f if the build fails"
  else
    fatal "disk" "${avail_gb} GB free on $root_dir -- the build needs roughly 8 GB"
    remedy "Grow the boot disk (the VM can stay running; the resize is online):
    gcloud compute disks resize <disk-name> --size=40GB --zone=<zone>
  then, on the VM:
    sudo growpart /dev/sda 1 && sudo resize2fs /dev/sda1
  Check the device first with: lsblk"
  fi

  # --- the checkout --------------------------------------------------------
  local missing=() p
  for p in "${REQUIRED_PATHS[@]}"; do
    if [[ ! -e "$REPO_DIR/$p" ]]; then missing+=("$p"); fi
  done
  if (( ${#missing[@]} )); then
    fatal "checkout" "${#missing[@]} required file(s) absent: ${missing[*]}"
    remedy "This is not a complete checkout. Re-clone, or copy the missing files across."
  else
    ok "checkout" "all seed SQL and the compose file are present"
  fi

  # The media is untracked in git, so a clone-based deploy arrives without it.
  # Nothing fails at build or boot -- a participant meets the 404 instead.
  local media_missing=()
  for p in "${MEDIA_PATHS[@]}"; do
    if [[ ! -e "$REPO_DIR/$p" ]]; then media_missing+=("$p"); fi
  done
  if (( ${#media_missing[@]} )); then
    warn "story media" "${#media_missing[@]} path(s) absent -- the stack will build and boot, then 404 mid-game"
    for p in "${media_missing[@]}"; do info "missing: $p"; done
    remedy "Copy the missing media onto the VM (rsync/scp from the machine that has it), or commit it and re-pull. Much of this media is untracked in git, so a plain clone will not have it."
  else
    ok "story media" "the audio, the rescue film, the laptop files and the diary are here"
  fi

  # The directory name IS the compose project name unless we pin it.
  local dir_project
  dir_project="$(basename "$REPO_DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
  if [[ $dir_project == "$PROJECT_NAME" ]]; then
    ok "compose project" "the directory name already matches $PROJECT_NAME"
  else
    info "directory would give compose the project name '$dir_project'"
    ok "compose project" "pinned to $PROJECT_NAME (otherwise the admin panel's Resources and Restart go blank)"
  fi

  # Provenance: is this VM running what was rehearsed?
  if have git && git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    local head dirty
    head="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
    dirty="$(git -C "$REPO_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
    if [[ $dirty == '0' ]]; then
      ok "revision" "$head (clean)"
    else
      warn "revision" "$head with $dirty uncommitted change(s) -- this VM is not running exactly what is in the repo"
    fi
  fi

  # --- the ports -----------------------------------------------------------
  local probe_line port busy=() rival=''
  if ! have ss; then
    # Saying "all nine are free" when nothing was looked at is worse than
    # saying nothing: the operator reads a PASS either way.
    warn "ports" "ss is not installed, so nothing could be checked (iproute2 provides it)"
    return 0
  fi
  for probe_line in "${PROBES[@]}"; do
    IFS='|' read -r port _ _ _ _ <<<"$probe_line"
    if ss -ltnH "sport = :$port" 2>/dev/null | grep -q .; then busy+=("$port"); fi
  done
  if (( ${#busy[@]} )); then
    # Ours, or somebody else's? A second checkout under a different project
    # name is the likely culprit, and it is the one case with an easy fix.
    if (( ${#DOCKER[@]} )); then
      # Ask which project PUBLISHES one of the busy ports, not merely which
      # other project happens to exist somewhere on this host.
      local pl proj
      while IFS=$'\t' read -r pl proj; do
        if [[ -z $proj || $proj == "$PROJECT_NAME" ]]; then continue; fi
        for port in "${busy[@]}"; do
          if [[ $pl == *":$port->"* ]]; then rival="$proj"; break 2; fi
        done
      done < <("${DOCKER[@]}" ps --format '{{.Ports}}'$'\t''{{.Label "com.docker.compose.project"}}' 2>/dev/null || true)
    fi
    if [[ -n $rival ]]; then
      fatal "ports" "${busy[*]} held by another compose project: $rival"
      remedy "Stop the other copy of the stack first (this keeps its data): ${DOCKER[*]:-docker} compose -p $rival down"
    else
      info "ports already listening: ${busy[*]}"
      ok "ports" "in use -- expected if the stack is already running here"
    fi
  else
    ok "ports" "all nine are free"
  fi

  # --- Google Cloud --------------------------------------------------------
  if ! on_gce; then
    warn "metadata server" "not reachable -- this does not look like a GCE VM"
    if [[ $LLM_PROVIDER == 'vertex' ]]; then
      remedy "Off Compute Engine, Vertex needs a service-account key: put it at secrets/gcp-key.json, uncomment the volume on mercy-engine in docker-compose.yml, and set GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcp-key.json in .env. Or run with --provider stub."
    fi
    return 0
  fi
  ok "metadata server" "reachable"

  EXTERNAL_IP="$(metadata 'instance/network-interfaces/0/access-configs/0/external-ip')"
  if [[ -n $EXTERNAL_IP ]]; then
    ok "external address" "$EXTERNAL_IP"
  else
    warn "external address" "none -- this VM has no external IP, so nobody outside the VPC can reach the event"
    remedy "Attach an external (ideally reserved static) IP to the instance."
  fi

  local sa scopes
  sa="$(metadata 'instance/service-accounts/default/email')"
  if [[ -z $sa ]]; then
    warn "service account" "none attached"
    remedy "Attach a service account with roles/aiplatform.user and the cloud-platform scope. This needs the VM stopped: gcloud compute instances set-service-account <vm> --service-account=<sa> --scopes=cloud-platform"
  else
    ok "service account" "$sa"
    scopes="$(metadata 'instance/service-accounts/default/scopes')"
    if printf '%s' "$scopes" | grep -q 'auth/cloud-platform'; then
      ok "access scopes" "cloud-platform"
    else
      bad "access scopes" "cloud-platform absent -- the token this VM can mint cannot call Vertex whatever the IAM roles say"
      remedy "Scopes can only be changed while the VM is stopped: gcloud compute instances stop <vm> && gcloud compute instances set-service-account <vm> --service-account=$sa --scopes=cloud-platform && gcloud compute instances start <vm>"
    fi
  fi

  if [[ $LLM_PROVIDER == 'vertex' ]]; then check_vertex; fi
  check_firewall
}

# Prove Vertex out of band: mint a token from the metadata server and make one
# real generateContent call. This exercises token issuance, API enablement, the
# IAM role, the project and the model name in a single request -- none of which
# the engine will tell us about, because it falls back to canned replies in
# silence. maxOutputTokens:1 keeps it to a fraction of a cent.
check_vertex() {
  local token_json token host url body code payload
  token_json="$(metadata 'instance/service-accounts/default/token')"
  token="$(json_get "$token_json" 'access_token')"
  if [[ -z $token ]]; then
    bad "vertex token" "the metadata server would not issue an access token"
    return 0
  fi

  if [[ $GCP_LOCATION == 'global' ]]; then
    host='aiplatform.googleapis.com'
  else
    host="${GCP_LOCATION}-aiplatform.googleapis.com"
  fi
  url="https://${host}/v1/projects/${GCP_PROJECT}/locations/${GCP_LOCATION}/publishers/google/models/${VERTEX_MODEL}:generateContent"
  payload='{"contents":[{"role":"user","parts":[{"text":"ping"}]}],"generationConfig":{"maxOutputTokens":1}}'

  body="$(curl -sS --max-time 25 -w $'\n%{http_code}' -X POST "$url" \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    -d "$payload" 2>/dev/null || printf '\n000')"
  code="${body##*$'\n'}"
  body="${body%$'\n'*}"

  case "$code" in
    200)
      ok "vertex ai" "$VERTEX_MODEL answered in $GCP_PROJECT/$GCP_LOCATION"
      ;;
    403|401)
      # The two 403s look identical in the engine's log and need opposite fixes.
      if printf '%s' "$body" | grep -q 'SERVICE_DISABLED\|has not been used in project\|is disabled'; then
        bad "vertex ai" "the Vertex AI API is not enabled in $GCP_PROJECT"
        remedy "gcloud services enable aiplatform.googleapis.com --project=$GCP_PROJECT"
      else
        bad "vertex ai" "permission denied for the attached service account"
        remedy "gcloud projects add-iam-policy-binding $GCP_PROJECT --member=serviceAccount:$(metadata 'instance/service-accounts/default/email') --role=roles/aiplatform.user"
      fi
      ;;
    404)
      bad "vertex ai" "no such model: $VERTEX_MODEL at $GCP_LOCATION"
      remedy "Check --model and --gcp-location. gemini-2.5-flash is served on the global endpoint."
      ;;
    000)
      bad "vertex ai" "no answer from $host -- no outbound internet, or egress is blocked"
      remedy "Check the VPC's egress rules and that the VM has a route to the internet (external IP or Cloud NAT)."
      ;;
    *)
      warn "vertex ai" "HTTP $code from $host"
      info "$(printf '%s' "$body" | head -c 300)"
      ;;
  esac

  if (( FAILURES )) && [[ $LLM_PROVIDER == 'vertex' ]]; then
    info "the game still runs without Vertex: MERCY falls back to canned replies"
  fi
}

# gcloud is not installed on a stock Ubuntu GCE image, so this is best-effort.
# Scope the query to THIS VM's network and tags: an ingress rule in another
# network, or one targeting tags this VM does not carry, is not our rule.
check_firewall() {
  if ! have gcloud; then
    warn "vpc firewall" "gcloud is not installed here, so the rule cannot be checked from the VM"
    remedy "From your own machine, confirm the nine ports are open:
    gcloud compute firewall-rules create mercy-event-ports --target-tags=<the VM's tag> --allow=$FIREWALL_PORTS --source-ranges=<the venue's range, or 0.0.0.0/0>"
    return 0
  fi

  local network tags rules
  network="$(metadata 'instance/network-interfaces/0/network')"
  network="${network##*/}"
  # gcloud's --target-tags wants commas; the human-readable line wants spaces.
  tags="$(metadata 'instance/tags' | tr -d '[]"')"
  local tags_human="${tags//,/ }"
  rules="$(gcloud compute firewall-rules list \
            --filter="network=$network AND direction=INGRESS AND allowed.ports:3030" \
            --format='value(name,targetTags.list(),sourceRanges.list())' 2>/dev/null || true)"
  if [[ -z $rules ]]; then
    warn "vpc firewall" "no ingress rule on network '$network' mentions port 3030"
    remedy "gcloud compute firewall-rules create mercy-event-ports --network=$network --target-tags=${tags:-<add a tag to the VM first>} --allow=$FIREWALL_PORTS --source-ranges=0.0.0.0/0"
  else
    ok "vpc firewall" "an ingress rule covers 3030 on '$network'"
    info "$rules"
    if [[ -n $tags ]]; then info "this VM's tags: $tags_human -- the rule's target tags must include one of them"; fi
  fi
}

# ---------------------------------------------------------------------------
# Stage: install -- Docker CE and the Compose v2 plugin
# ---------------------------------------------------------------------------

stage_install() {
  step "Install -- Docker Engine and the Compose plugin"

  if have docker && docker compose version >/dev/null 2>&1; then
    resolve_docker
    if (( ${#DOCKER[@]} )); then
      ok "docker" "$("${DOCKER[@]}" version -f '{{.Server.Version}}' 2>/dev/null || printf 'already installed')"
      ensure_docker_group
      return 0
    fi
  fi

  # Docker's own docs call these out as conflicting. Leaving them installed is
  # how you end up with containerd.io refusing to configure halfway through.
  local conflicting=(docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc)
  local installed=() p
  for p in "${conflicting[@]}"; do
    if dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'ok installed'; then installed+=("$p"); fi
  done
  if (( ${#installed[@]} )); then
    info "removing packages that conflict with Docker CE: ${installed[*]}"
    apt_get remove -y "${installed[@]}" >/dev/null
  fi

  # Clear any docker.list we (or anyone) wrote earlier. A previous failed run
  # can leave one naming a repository that does not exist, and apt-get update
  # fails on it -- BEFORE the code below gets a chance to write the right one.
  # The correct file is rewritten a few lines down, so removing it costs
  # nothing and makes a retry actually retry.
  if [[ -e /etc/apt/sources.list.d/docker.list ]]; then
    as_root rm -f /etc/apt/sources.list.d/docker.list
  fi

  info "apt-get update (waits up to 5 minutes for unattended-upgrades to finish)"
  apt_get update -qq
  apt_get install -y -qq ca-certificates curl gnupg git jq >/dev/null

  # The official repository, not get.docker.com: the convenience script is
  # explicitly not recommended for production, and it cannot be re-run safely.
  #
  # Docker publishes a separate tree per distribution, and the codename lives
  # under a different key on each: a Debian image would otherwise be handed
  # "ubuntu trixie", which does not exist, and apt fails with a Release file
  # error that says nothing about why.
  local distro codename arch
  # shellcheck disable=SC1091
  distro="$(. /etc/os-release && printf '%s' "${ID:-ubuntu}")"
  # shellcheck disable=SC1091
  codename="$(. /etc/os-release && printf '%s' "${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}")"
  case "$distro" in
    ubuntu|debian) : ;;
    linuxmint|pop|neon|zorin|elementary)
      # Ubuntu derivatives: Docker has no tree of their own, and their own
      # VERSION_CODENAME is not one Docker knows.
      # shellcheck disable=SC1091
      codename="$(. /etc/os-release && printf '%s' "${UBUNTU_CODENAME:-}")"
      distro=ubuntu ;;
    *)
      die "this installs Docker from Docker's apt repository, which covers only Debian and Ubuntu. This VM is '$distro'. Either recreate it from an Ubuntu 24.04 LTS image, or install Docker Engine 24+ and the compose plugin yourself and re-run with --stage=configure,build,start,verify." ;;
  esac
  if [[ -z $codename ]]; then
    die "cannot read the release codename from /etc/os-release, so the Docker apt repository cannot be named"
  fi

  # Confirm Docker actually publishes for this release BEFORE committing it to
  # sources.list. A missing tree caught here is a clear message; discovered by
  # apt-get update it is "does not have a Release file" and a dead end.
  if ! curl -fsSL -o /dev/null --max-time 15 \
       "https://download.docker.com/linux/$distro/dists/$codename/Release"; then
    bad "docker repository" "Docker publishes nothing for $distro $codename"
    remedy "Recreate the VM from an Ubuntu 24.04 LTS image -- Docker publishes for noble, and that is what this stack was built and rehearsed on. Failing that, install the distribution's own docker.io and docker-compose-v2, but check the engine is 24.0 or newer first: the admin panel calls Docker API v1.43."
    die "no Docker apt repository for $distro $codename"
  fi
  info "Docker repository: $distro $codename"

  as_root install -m 0755 -d /etc/apt/keyrings
  if [[ ! -s /etc/apt/keyrings/docker.asc ]]; then
    curl -fsSL "https://download.docker.com/linux/$distro/gpg" \
      | as_root tee /etc/apt/keyrings/docker.asc >/dev/null
    as_root chmod a+r /etc/apt/keyrings/docker.asc
  fi

  arch="$(dpkg --print-architecture)"
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$arch" "$distro" "$codename" | as_root tee /etc/apt/sources.list.d/docker.list >/dev/null

  apt_get update -qq
  apt_get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin >/dev/null

  as_root systemctl enable --now docker >/dev/null 2>&1 || true

  ensure_docker_group
  resolve_docker
  if (( ! ${#DOCKER[@]} )); then
    die "docker installed but the daemon is not reachable. Try: sudo systemctl status docker"
  fi

  # The lobby speaks a hardcoded Docker Engine API /v1.43, which needs Engine
  # 24.0 or newer, so the version is load-bearing rather than cosmetic.
  local ver; ver="$("${DOCKER[@]}" version -f '{{.Server.Version}}' 2>/dev/null || printf 'unknown')"
  local major="${ver%%.*}"
  if [[ $major =~ ^[0-9]+$ ]] && (( major >= 24 )); then
    ok "docker engine" "$ver"
  else
    warn "docker engine" "$ver -- the admin panel calls Docker API v1.43, which needs Engine 24.0+"
  fi
  ok "compose plugin" "$("${DOCKER[@]}" compose version --short 2>/dev/null || printf 'installed')"
  HAVE_JQ=0; if have jq; then HAVE_JQ=1; fi
}

ensure_docker_group() {
  if [[ $(id -u) -eq 0 ]]; then return 0; fi
  if id -nG "$(id -un)" 2>/dev/null | tr ' ' '\n' | grep -qx 'docker'; then return 0; fi
  as_root usermod -aG docker "$(id -un)"
  NEEDS_RELOGIN=1
  info "added $(id -un) to the docker group -- this run uses sudo -g docker; log out and back in for plain 'docker' to work"
}

# ---------------------------------------------------------------------------
# Stage: configure -- .env
# ---------------------------------------------------------------------------

env_file() { printf '%s/.env' "$REPO_DIR"; }

# Read a key out of .env without sourcing it (a value with a space, a quote or
# a '#' would make `source` do something different from what Compose does).
env_read() {
  local key="$1" f; f="$(env_file)"
  [[ -f $f ]] || return 0
  sed -n "s/^[[:space:]]*${key}=//p" "$f" | tail -n1 || true
}

resolve_admin_password() {
  local existing; existing="$(env_read 'ADMIN_PASSWORD')"

  # A flag or the environment beats what is already in .env: the operator who
  # passes one has decided. Anything else silently ignores them, and they find
  # out at the admin desk.
  if [[ -n $ADMIN_PASSWORD_FILE ]]; then
    [[ -r $ADMIN_PASSWORD_FILE ]] || die "cannot read $ADMIN_PASSWORD_FILE"
    ADMIN_PASSWORD="$(head -n1 "$ADMIN_PASSWORD_FILE" | tr -d '\r\n')"
    ADMIN_PASSWORD_SOURCE="--admin-password-file"
  elif [[ -n $ADMIN_PASSWORD ]]; then
    ADMIN_PASSWORD_SOURCE="MERCY_ADMIN_PASSWORD"
  elif [[ -n $existing && $existing != 'change-me' ]] && (( ! FORCE_PASSWORD )); then
    ADMIN_PASSWORD="$existing"
    ADMIN_PASSWORD_SOURCE="the .env already here"
  elif [[ -t 0 ]] && (( ! ASSUME_YES )); then
    local a='' b=''
    while :; do
      read -r -s -p "  admin password (not echoed): " a || die "no password entered"; printf '\n'
      read -r -s -p "  again: " b || die "no password entered"; printf '\n'
      if [[ -z $a ]]; then printf '  empty -- try again\n'; continue; fi
      if [[ $a != "$b" ]]; then printf '  they differ -- try again\n'; continue; fi
      break
    done
    ADMIN_PASSWORD="$a"
    ADMIN_PASSWORD_SOURCE="the prompt"
  else
    ADMIN_PASSWORD="$(gen_password)"
    GENERATED_PASSWORD_FILE="$REPO_DIR/admin-password.txt"
    ( umask 077; printf '%s\n' "$ADMIN_PASSWORD" >"$GENERATED_PASSWORD_FILE" )
    ADMIN_PASSWORD_SOURCE="generated"
  fi

  [[ -n $ADMIN_PASSWORD ]] || die "no admin password"

  # Compose interpolates ${...} inside .env values, so these characters do not
  # survive the trip to the container and the desk cannot log in.
  case "$ADMIN_PASSWORD" in
    *'$'*|*'\'*|*'`'*|*'"'*)
      die "the admin password contains a character Compose would interpolate out of .env (one of $ backslash backtick double-quote), so it would reach mercy-lobby altered and the admin page would reject it. Choose one without them." ;;
  esac
  if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
    warn "admin password" "only ${#ADMIN_PASSWORD} characters, and port 3030 is open to the venue"
  fi
}

# The project name is pinned, so this script always drives "mercy-aijudgement"
# whatever directory it is run from -- but every file it reads and writes (.env,
# the seed SQL, the build context) comes from THIS checkout. A second copy of
# the repo would therefore reconfigure and restart the first copy's live stack
# while reading its own files. Refuse instead.
assert_owns_running_stack() {
  if (( ! ${#DOCKER[@]} )); then return 0; fi
  local running first dir here theirs
  running="$("${DOCKER[@]}" ps -q --filter "label=com.docker.compose.project=$PROJECT_NAME" 2>/dev/null | wc -l | tr -d ' ')"
  if (( ! running )); then return 0; fi
  first="$("${DOCKER[@]}" ps -q --filter "label=com.docker.compose.project=$PROJECT_NAME" 2>/dev/null | head -n1)"
  dir="$("${DOCKER[@]}" inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$first" 2>/dev/null || true)"
  if [[ -z $dir ]]; then return 0; fi

  # Compare real paths where we can. The label is written by whichever docker
  # CLI created the container, so on Windows it reads "S:\MERCY-AI JUDGEMENT"
  # while this shell says "/s/MERCY-AI JUDGEMENT" -- the same directory. Fold
  # both to one shape before deciding they differ.
  normalise() {
    local x="${1//\\//}"
    x="$(printf '%s' "$x" | tr '[:upper:]' '[:lower:]')"
    x="${x%/}"
    # a leading drive letter, c:/foo -> /c/foo
    if [[ $x =~ ^([a-z]):/(.*)$ ]]; then x="/${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"; fi
    printf '%s' "$x"
  }
  here="$(normalise "$(cd -- "$REPO_DIR" && pwd -P)")"
  theirs="$(normalise "$dir")"
  if [[ $here == "$theirs" ]]; then return 0; fi

  # Still different. This is worth stopping for -- a second checkout would
  # reconfigure and restart the first one's live stack while reading its own
  # files -- but path comparison across platforms is not certain enough to
  # refuse outright.
  warn "checkout" "the project $PROJECT_NAME is running from '$dir', which does not look like this checkout"
  info "here: $REPO_DIR"
  if confirm "Configure and restart that stack from here anyway?"; then
    info "continuing at your say-so"
    return 0
  fi
  remedy "Two checkouts cannot both drive one project name. Either run setup.sh from '$dir', or stop that stack first (its databases survive): ${DOCKER[*]:-docker} compose -p $PROJECT_NAME down"
  die "refusing to reconfigure a stack that was started from another directory"
}

stage_configure() {
  step "Configure -- .env"
  assert_owns_running_stack

  local f; f="$(env_file)"
  local creating=1
  if [[ -f $f ]]; then
    creating=0
    ENV_BACKUP="$f.bak.$(date +%Y%m%d-%H%M%S)"
    cp "$f" "$ENV_BACKUP"
    chmod 600 "$ENV_BACKUP"
    info "backed the existing .env up to $(basename "$ENV_BACKUP")"
  fi

  resolve_admin_password

  # Generate a secret only if .env does not already carry a real one. The
  # session secret signs every participant's cookie: rotating it mid-event logs
  # the whole room out at once.
  # $3 = 'keep' means --rotate-keys does not touch it. MERCY_SESSION_SECRET is
  # keep: rotating it invalidates every participant cookie at once, which
  # mid-event logs the whole room out of a game they are 15 minutes into.
  keep_or_make() {
    local key="$1" placeholder="$2" mode="${3:-rotatable}" current
    current="$(env_read "$key")"
    if [[ -n $current && $current != "$placeholder" ]] && { [[ $mode == 'keep' ]] || [[ $ROTATE_KEYS != 'always' ]]; }; then
      printf '%s' "$current"
    else
      gen_secret 32
    fi
  }

  local session_secret internal_key mercy_key jwt_secret
  session_secret="$(keep_or_make 'MERCY_SESSION_SECRET' 'change-me-to-a-long-random-string' 'keep')"
  internal_key="$(keep_or_make 'INTERNAL_API_KEY' 'dev-internal-key')"
  mercy_key="$(keep_or_make 'MERCY_API_KEY' 'dev-mercy-key')"
  jwt_secret="$(keep_or_make 'JWT_SECRET' 'dev-only-secret-change-me')"

  # Write through a temp file with a tight umask: .env holds the admin password
  # and every shared key, and a half-written .env is worse than none.
  # Every key this writer does not own is carried across verbatim. Without it,
  # a hand-added GOOGLE_APPLICATION_CREDENTIALS -- the documented way to run
  # off Compute Engine -- is silently dropped on the next run and the
  # deployment quietly changes behaviour.
  local -a OWNED=(MERCY_SESSION_SECRET ADMIN_PASSWORD GAME_MINUTES MERCY_SINGLE_PLAYER
                  INTERNAL_API_KEY MERCY_API_KEY JWT_SECRET MERCY_LLM_PROVIDER
                  GOOGLE_CLOUD_PROJECT GOOGLE_CLOUD_LOCATION VERTEX_MODEL COMPOSE_PROJECT_NAME)
  local -a carried=()
  if [[ -f $f ]]; then
    local line key k owned
    while IFS= read -r line || [[ -n $line ]]; do
      case "$line" in ''|'#'*) continue ;; esac
      case "$line" in *=*) ;; *) continue ;; esac
      key="${line%%=*}"; key="${key// /}"
      owned=0
      for k in "${OWNED[@]}"; do if [[ $key == "$k" ]]; then owned=1; fi; done
      if (( ! owned )); then carried+=("$line"); fi
    done <"$f"
  fi

  local tmp; tmp="$(mktemp "$REPO_DIR/.env.XXXXXX")"
  chmod 600 "$tmp"
  {
    printf '# Written by setup.sh on %s. Compose reads this automatically.\n' "$(date -Is)"
    printf '# Values here are interpolated by Compose: avoid $, backslash and backticks.\n\n'
    printf '# --- the event -----------------------------------------------------------\n'
    printf 'MERCY_SESSION_SECRET=%s\n' "$session_secret"
    printf 'ADMIN_PASSWORD=%s\n' "$ADMIN_PASSWORD"
    printf 'GAME_MINUTES=%s\n' "$GAME_MINUTES"
    printf 'MERCY_SINGLE_PLAYER=%s\n\n' "$SINGLE_PLAYER"
    printf '# --- the keys the services trust each other with --------------------------\n'
    printf '# These guard /api/internal/* and /api/evidence on ports the participants\n'
    printf '# can reach, and the repo defaults are public. Rotating them is safe.\n'
    printf 'INTERNAL_API_KEY=%s\n' "$internal_key"
    printf 'MERCY_API_KEY=%s\n' "$mercy_key"
    printf 'JWT_SECRET=%s\n\n' "$jwt_secret"
    printf "# --- MERCY's brain --------------------------------------------------------\n"
    printf 'MERCY_LLM_PROVIDER=%s\n' "$LLM_PROVIDER"
    printf 'GOOGLE_CLOUD_PROJECT=%s\n' "$GCP_PROJECT"
    printf 'GOOGLE_CLOUD_LOCATION=%s\n' "$GCP_LOCATION"
    printf 'VERTEX_MODEL=%s\n' "$VERTEX_MODEL"
    printf '# On a GCE VM leave GOOGLE_APPLICATION_CREDENTIALS unset: the engine\n'
    printf '# authenticates through the metadata server.\n\n'
    printf '# Pinned, and load-bearing: mercy-lobby lists the stack by this label, so a\n'
    printf "# different project name empties the admin panel's Resources page.\n"
    printf 'COMPOSE_PROJECT_NAME=%s\n' "$PROJECT_NAME"
    if (( ${#carried[@]} )); then
      printf '\n# carried over from the previous .env\n'
      printf '%s\n' "${carried[@]}"
    fi
  } >"$tmp"
  mv -f "$tmp" "$f"
  chmod 600 "$f"

  if (( creating )); then ok ".env" "created, mode 600"; else ok ".env" "rewritten, mode 600"; fi
  if (( ${#carried[@]} )); then
    info "carried over ${#carried[@]} key(s) this script does not own: $(printf '%s ' "${carried[@]%%=*}")"
  fi
  info "admin password from: $ADMIN_PASSWORD_SOURCE"
  if [[ -n $GENERATED_PASSWORD_FILE ]]; then
    info "written to $GENERATED_PASSWORD_FILE (mode 600) -- read it before the event and delete it after"
  fi
  info "provider: $LLM_PROVIDER   project: $GCP_PROJECT   location: $GCP_LOCATION   model: $VERTEX_MODEL"

  # The one cheap command that proves the file parses AND that every ${VAR}
  # interpolated cleanly -- before a six-minute build rather than after it.
  if (( ${#COMPOSE[@]} )); then
    if "${COMPOSE[@]}" config -q 2>/dev/null; then
      ok "compose config" "parses, and every variable resolved"
    else
      bad "compose config" "docker compose config failed -- something in .env or docker-compose.yml is malformed"
      { "${COMPOSE[@]}" config -q 2>&1 || true; } | head -n 10 | while IFS= read -r l; do info "$l"; done
      die "refusing to build against a compose file that does not parse"
    fi
    # And that the nine ports the firewall rule opens are still the nine the
    # compose file publishes.
    local declared expected
    declared="$("${COMPOSE[@]}" config --format json 2>/dev/null \
      | tr ',' '\n' | grep -o '"published"[^0-9]*[0-9]\+' | grep -o '[0-9]\+$' | sort -n | tr '\n' ' ' || true)"
    expected='3000 3020 3030 4001 4002 4003 4008 4010 4011 '
    if [[ -n $declared && $declared != "$expected" ]]; then
      warn "published ports" "compose publishes: ${declared}-- the firewall rule this script prints covers: ${expected}"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Stage: build
# ---------------------------------------------------------------------------

# "compose images" lists the images of the project's CREATED CONTAINERS, so it
# is empty after a "compose down" even though all nine images are in the local
# store. Ask the image store itself.
images_exist() {
  local n
  n="$("${DOCKER[@]}" images -q --filter "label=com.docker.compose.project=$PROJECT_NAME" 2>/dev/null | wc -l | tr -d ' ')"
  (( n >= 9 ))
}

stage_build() {
  step "Build -- nine images"

  if [[ $DO_BUILD == 'never' ]]; then
    info "skipped (--no-build)"
    return 0
  fi
  if [[ $DO_BUILD == 'auto' ]] && images_exist; then
    ok "build" "images already exist -- skipped (use --rebuild to force)"
    # Seven of the nine services have no lockfile, so a rebuild resolves
    # dependencies fresh against the npm registry. Rebuilding on event morning
    # can produce a different stack from the one that was rehearsed.
    info "seven services build without a lockfile, so a rebuild may resolve different dependencies -- rebuild days early, not on the morning"
    return 0
  fi

  info "this takes 3-6 minutes cold: nine images, seven npm installs and one vite build, in parallel"
  "${COMPOSE[@]}" build --pull
  BUILT=1
  ok "build" "nine images built"
}

# ---------------------------------------------------------------------------
# Stage: start
# ---------------------------------------------------------------------------

probe_once() {
  local port="$1" kind="$2" marker="$3" url body code
  if [[ $kind == 'json' ]]; then url="http://127.0.0.1:$port/api/health"; else url="http://127.0.0.1:$port/"; fi
  body="$(http_get "$url" 6)"
  code="${body##*$'\n'}"
  body="${body%$'\n'*}"
  [[ $code == '200' ]] || return 1
  if [[ $kind == 'json' ]]; then
    printf '%s' "$body" | grep -q "\"service\":\"$marker\""
  else
    printf '%s' "$body" | grep -qF "$marker"
  fi
}

# Round-robin every outstanding probe against one shared deadline. Waiting on
# them one at a time means a single broken service eats the whole budget before
# the other eight are tried even once.
wait_for_services() {
  local deadline=$(( SECONDS + READY_TIMEOUT ))
  local -a pending=("${PROBES[@]}") still=()
  local line port kind marker svc desc

  info "waiting up to ${READY_TIMEOUT}s for all nine services to answer"
  while (( ${#pending[@]} )) && (( SECONDS < deadline )); do
    still=()
    for line in "${pending[@]}"; do
      IFS='|' read -r port kind marker svc desc <<<"$line"
      if probe_once "$port" "$kind" "$marker"; then
        ok "$svc" "$port -- $desc"
      else
        still+=("$line")
      fi
    done
    pending=("${still[@]+"${still[@]}"}")
    if (( ${#pending[@]} )); then sleep 3; fi
  done

  if (( ${#pending[@]} )); then
    for line in "${pending[@]}"; do
      IFS='|' read -r port kind marker svc desc <<<"$line"
      bad "$svc" "$port never answered within ${READY_TIMEOUT}s"
      info "$("${COMPOSE[@]}" logs --no-color --tail 15 "$svc" 2>/dev/null | tail -n 15 | sed 's/^/      /' || true)"
    done
    remedy "Read the full log for a service that never came up: ${DOCKER[*]:-docker} compose -p $PROJECT_NAME logs --tail 200 <service>"
    return 1
  fi
  return 0
}

stage_start() {
  step "Start -- bringing the stack up"
  assert_owns_running_stack

  local -a up=(up -d --remove-orphans)
  # Only when stage_build actually built. Otherwise the "images already exist,
  # skipped" path would rebuild anyway from here, which is the opposite of what
  # it just told the operator -- and on event morning a rebuild resolves fresh
  # npm dependencies for the seven services that have no lockfile.
  if (( BUILT )); then up+=(--build); fi
  if (( RECREATE )); then up+=(--force-recreate); fi

  "${COMPOSE[@]}" "${up[@]}"

  local running
  running="$("${COMPOSE[@]}" ps -q 2>/dev/null | wc -l | tr -d ' ')"
  if (( running == EXPECTED_CONTAINERS )); then
    ok "containers" "$running of $EXPECTED_CONTAINERS"
  else
    warn "containers" "$running, expected $EXPECTED_CONTAINERS"
  fi

  wait_for_services || true
}

# ---------------------------------------------------------------------------
# Stage: verify -- read-only. Safe to run mid-event.
# ---------------------------------------------------------------------------

# The one thing a green health table cannot tell you: are the ports bound on
# every interface, or only on loopback? A loopback-only bind passes every
# check in this script and is unreachable from the venue.
check_bindings() {
  if ! have ss; then return 0; fi
  local line port loopback_only=()
  for line in "${PROBES[@]}"; do
    IFS='|' read -r port _ _ _ _ <<<"$line"
    if ss -ltnH "sport = :$port" 2>/dev/null | grep -q '127\.0\.0\.1:'"$port"'\|\[::1\]:'"$port"; then
      if ! ss -ltnH "sport = :$port" 2>/dev/null | grep -q '0\.0\.0\.0:'"$port"'\|\*:'"$port"'\|\[::\]:'"$port"; then
        loopback_only+=("$port")
      fi
    fi
  done
  if (( ${#loopback_only[@]} )); then
    bad "port bindings" "${loopback_only[*]} are bound to loopback only -- nobody outside this VM can reach them"
  else
    ok "port bindings" "published on all interfaces"
  fi
}

# The COMPOSE_PROJECT mismatch has an exact signature: the lobby reports
# "docker":true (the socket is there) and "containers":[] (the label filter
# matched nothing). Catching it here is the whole reason this check exists.
check_admin_api() {
  local jar body code n
  jar="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '$jar'" RETURN

  # No escaping is needed here: resolve_admin_password rejects " \ $ and
  # backticks, so the password is safe for JSON and for Compose alike. It goes
  # to curl on stdin because argv is world readable through /proc.
  body="$(printf '{"password":"%s"}' "$ADMIN_PASSWORD" \
    | curl -sS --max-time 10 -w $'\n%{http_code}' -c "$jar" \
        -X POST 'http://127.0.0.1:3030/api/admin/login' \
        -H 'content-type: application/json' --data-binary @- \
        2>/dev/null || printf '\n000')"
  code="${body##*$'\n'}"
  case "$code" in
    200) ok "admin sign-in" "the password from $ADMIN_PASSWORD_SOURCE works" ;;
    401|403)
      bad "admin sign-in" "rejected -- the password from $ADMIN_PASSWORD_SOURCE is not the one the desk will need"
      remedy "Set the password the desk will actually type: ./setup.sh --stage=configure,start --admin-password-file <file>"
      return 0 ;;
    *)
      # curl could not reach it at all, or the lobby answered 5xx. Either
      # way this is the lobby being down, which is not a password problem.
      bad "admin sign-in" "no usable answer from the lobby (HTTP $code) -- the lobby is down, not the password"
      remedy "${DOCKER[*]:-docker} compose -p $PROJECT_NAME logs --tail 50 mercy-lobby"
      return 0 ;;
  esac

  body="$(curl -sS --max-time 20 -w $'\n%{http_code}' -b "$jar" \
    'http://127.0.0.1:3030/api/admin/resources' 2>/dev/null || printf '\n000')"
  code="${body##*$'\n'}"
  body="${body%$'\n'*}"
  if [[ $code != '200' ]]; then
    # Without the status, a 500 from a crashed lobby-db carries a JSON error
    # body with no containers in it and reads exactly like a project-label
    # mismatch -- two very different problems, one misleading message.
    bad "admin resources" "HTTP $code from the lobby -- the lobby failing, not the project label"
    remedy "${DOCKER[*]:-docker} compose -p $PROJECT_NAME logs --tail 50 mercy-lobby lobby-db"
    return 0
  fi
  # Count inside .containers only: "service" also appears once per entry in
  # the sibling .services array, so a whole-body grep invents six containers.
  if (( HAVE_JQ )); then
    n="$(printf '%s' "$body" | jq -r '[.containers[]?] | length' 2>/dev/null || printf '0')"
  elif have python3; then
    n="$(printf '%s' "$body" | python3 -c 'import json,sys
try:
    print(len(json.load(sys.stdin).get("containers") or []))
except Exception:
    print(0)' 2>/dev/null || printf '0')"
  else
    n=0
  fi
  if (( n >= EXPECTED_CONTAINERS )); then
    # all=1 in the lobby's query, so stopped containers from earlier runs count
    ok "admin resources" "the panel can see the stack ($n containers, stopped ones included)"
  elif (( n == 0 )); then
    bad "admin resources" "the panel sees zero containers -- the compose project label does not match COMPOSE_PROJECT=$PROJECT_NAME"
    remedy "Re-run ./setup.sh --stage=configure,start so the stack is recreated under the project name $PROJECT_NAME. The admin panel's Resources page and its Restart button stay dead until then."
  else
    warn "admin resources" "the panel sees $n of $EXPECTED_CONTAINERS containers"
  fi
}

# Has PREPARE TEMPLATES already been run, and how long ago? The seeds anchor
# the story's "last night" to the day they were laid, so a template seeded
# yesterday makes every timestamp in the game a day out.
check_templates() {
  local last
  last="$("${COMPOSE[@]}" exec -T lobby-db psql -U mercy -d lobby -tAc \
    "SELECT to_char(max(at), 'YYYY-MM-DD HH24:MI') FROM admin_events WHERE kind='prepare'" 2>/dev/null | tr -d '\r' || true)"
  if [[ -z $last ]]; then
    info "templates have not been prepared yet -- do it from the admin panel on the day (Event -> PREPARE TEMPLATES)"
    return 0
  fi
  local today; today="$(date +%Y-%m-%d)"
  if [[ $last == "$today"* ]]; then
    ok "templates" "prepared today at ${last#* }"
  else
    warn "templates" "last prepared $last -- the story's timestamps are anchored to that day, not today"
    remedy "Re-anchor the story to today: sign in at /admin, run RESET EVERY GAME, then PREPARE TEMPLATES. This clears every participant's progress, so do it before the doors open."
  fi
}

# The engine reaches Google over the docker bridge, not the host's stack. The
# host-side Vertex check in preflight does not prove the CONTAINER can mint a
# token, so ask the container itself.
check_engine_credentials() {
  if [[ $LLM_PROVIDER != 'vertex' ]]; then return 0; fi
  if "${COMPOSE[@]}" exec -T mercy-engine node -e '
const http = require("http");
const req = http.get({
  host: "169.254.169.254",
  path: "/computeMetadata/v1/instance/service-accounts/default/token",
  headers: { "Metadata-Flavor": "Google" },
  timeout: 5000,
}, (r) => process.exit(r.statusCode === 200 ? 0 : 1));
req.on("error", () => process.exit(1));
req.on("timeout", () => process.exit(1));
' >/dev/null 2>&1; then
    ok "engine credentials" "mercy-engine can mint a token from inside the container"
  else
    bad "engine credentials" "mercy-engine cannot reach the metadata server -- it will serve canned replies"
    remedy "Check that the VM has a service account attached and that nothing blocks 169.254.169.254 from the docker bridge."
  fi
}

check_engine_provider() {
  local logged
  # --tail rather than --since: on event morning the engine started hours ago,
  # and a time window would miss the one line it ever prints about this.
  logged="$("${COMPOSE[@]}" logs --no-color --tail 500 mercy-engine 2>/dev/null \
            | grep -o 'llm provider: [a-z]*' | tail -n1 || true)"
  if [[ -z $logged ]]; then
    warn "engine provider" "the startup line is not in the last 500 log lines -- provider unverified"
  elif [[ $logged == "llm provider: $LLM_PROVIDER" ]]; then
    ok "engine provider" "$logged"
  else
    bad "engine provider" "the engine booted with '$logged' but .env asks for $LLM_PROVIDER -- it has not been restarted since .env changed"
    remedy "${DOCKER[*]:-docker} compose -p $PROJECT_NAME up -d mercy-engine"
  fi

  local fell_back
  fell_back="$("${COMPOSE[@]}" logs --no-color --tail 500 mercy-engine 2>/dev/null \
               | grep -c 'using the stub' || true)"
  if [[ ${fell_back:-0} =~ ^[0-9]+$ ]] && (( fell_back > 0 )); then
    warn "vertex at runtime" "$fell_back fallback(s) to canned replies in the last 500 log lines"
    remedy "If Vertex is flapping, prefer it off to slow: every failed turn costs the participant a 20 s timeout first. Set MERCY_LLM_PROVIDER=stub in .env and run: ${DOCKER[*]:-docker} compose -p $PROJECT_NAME up -d mercy-engine"
  fi
}

stage_verify() {
  step "Verify -- is the event healthy?"

  local line port kind marker svc desc
  for line in "${PROBES[@]}"; do
    IFS='|' read -r port kind marker svc desc <<<"$line"
    if probe_once "$port" "$kind" "$marker"; then
      ok "$svc" "$port -- $desc"
    else
      bad "$svc" "$port is not serving"
    fi
  done

  local running
  running="$("${COMPOSE[@]}" ps -q 2>/dev/null | wc -l | tr -d ' ')"
  if (( running == EXPECTED_CONTAINERS )); then
    ok "containers" "$running of $EXPECTED_CONTAINERS running"
  else
    bad "containers" "$running of $EXPECTED_CONTAINERS running"
    # --all so the stopped ones actually show, and grep's "matched nothing"
    # exit status swallowed: under pipefail it would otherwise trip the ERR
    # trap and abort the report in the one case the report matters.
    "${COMPOSE[@]}" ps --all --format '{{.Service}}\t{{.State}}' 2>/dev/null \
      | { grep -v 'running' || true; } | while IFS= read -r l; do info "$l"; done
  fi

  local labelled
  labelled="$("${DOCKER[@]}" ps -q --filter "label=com.docker.compose.project=$PROJECT_NAME" 2>/dev/null | wc -l | tr -d ' ')"
  if (( labelled == EXPECTED_CONTAINERS )); then
    ok "compose project" "$PROJECT_NAME -- the label the admin panel filters on"
  else
    bad "compose project" "$labelled containers carry the label com.docker.compose.project=$PROJECT_NAME"
  fi

  check_bindings

  # In a verify run .env is the file the running stack was actually started
  # from, so it beats whatever MERCY_ADMIN_PASSWORD happens to be in this shell.
  local from_env; from_env="$(env_read 'ADMIN_PASSWORD')"
  if [[ -n $from_env ]]; then
    ADMIN_PASSWORD="$from_env"; ADMIN_PASSWORD_SOURCE='.env'
  fi
  if [[ -n $ADMIN_PASSWORD ]]; then
    check_admin_api
  else
    # Silence, in a report whose whole contract is the table, reads as success.
    # And there is a real default behind it: with nothing in .env the lobby
    # falls back to the compose default, which is published in this repo.
    bad "admin sign-in" "no ADMIN_PASSWORD in .env -- the lobby is on the compose default 'mercy-admin', which anyone can read in this repo"
    remedy "Set a real one: ./setup.sh --stage=configure,start --admin-password-file <file>"
  fi
  check_engine_provider
  check_engine_credentials
  check_templates
}

# ---------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------

write_stamp() {
  local f="$REPO_DIR/.mercy-deploy.json" head dirty
  head='unknown'; dirty='?'
  if have git && git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    head="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || printf 'unknown')"
    dirty="$(git -C "$REPO_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  fi
  {
    printf '{\n'
    printf '  "deployed_at": "%s",\n' "$(date -Is)"
    printf '  "revision": "%s",\n' "$head"
    printf '  "uncommitted_files": "%s",\n' "$dirty"
    printf '  "compose_project": "%s",\n' "$PROJECT_NAME"
    printf '  "provider": "%s",\n' "$LLM_PROVIDER"
    printf '  "model": "%s",\n' "$VERTEX_MODEL"
    printf '  "docker": "%s",\n' "$("${DOCKER[@]}" version -f '{{.Server.Version}}' 2>/dev/null || printf 'unknown')"
    printf '  "compose": "%s",\n' "$("${DOCKER[@]}" compose version --short 2>/dev/null || printf 'unknown')"
    printf '  "external_ip": "%s"\n' "$EXTERNAL_IP"
    printf '}\n'
  } >"$f" 2>/dev/null || true
}

report() {
  local host="${EXTERNAL_IP:-<the external IP of the VM>}"

  printf '\n%s%s---- summary ----%s\n' "$C_BOLD" "$C_CYN" "$C_OFF"
  local row status label detail
  for row in "${ROWS[@]+"${ROWS[@]}"}"; do
    IFS='|' read -r status label detail <<<"$row"
    case "$status" in
      PASS) printf '  %sPASS%s  %-22s %s\n' "$C_GRN" "$C_OFF" "$label" "$detail" ;;
      WARN) printf '  %sWARN%s  %-22s %s\n' "$C_YEL" "$C_OFF" "$label" "$detail" ;;
      FAIL) printf '  %sFAIL%s  %-22s %s\n' "$C_RED" "$C_OFF" "$label" "$detail" ;;
    esac
  done
  printf '\n  %d passed, %d warning(s), %d failure(s)\n' \
    "$(( ${#ROWS[@]} - WARNINGS - FAILURES ))" "$WARNINGS" "$FAILURES"

  if (( ${#REMEDIES[@]} )); then
    printf '\n%s%s---- what to do about it ----%s\n' "$C_BOLD" "$C_YEL" "$C_OFF"
    local r
    for r in "${REMEDIES[@]}"; do printf '\n  * %s\n' "$r"; done
  fi

  if wants 'start' || wants 'verify'; then
    printf '\n%s%s---- the event ----%s\n' "$C_BOLD" "$C_CYN" "$C_OFF"
    printf '\n  participants   http://%s:3030/\n' "$host"
    printf '  admin desk     http://%s:3030/admin\n' "$host"
    printf '  leaderboard    http://%s:3030/leaderboard\n' "$host"
    printf '\n  On the day, in this order:\n'
    printf '    1. sign in at /admin\n'
    printf '    2. Participants -> paste "ZIN26-0158, Name" lines\n'
    printf '    3. Event -> PREPARE TEMPLATES  (seeds every service; do it on the\n'
    printf "       day, so the story's \"last night\" really is last night)\n"
    printf '    4. give the room the participants URL\n'

    printf '\n%s  A green table above proves the VM serves itself. It says nothing\n' "$C_BOLD"
    printf '  about whether the room can reach it -- the VPC firewall is exactly\n'
    printf '  what cannot be tested from inside. Run this from your phone on the\n'
    printf '  venue wifi before you open the doors:%s\n\n' "$C_OFF"
    printf '    curl -sS --max-time 5 http://%s:3030/api/health\n' "$host"
  fi

  printf '\n%s%s---- keeping it alive ----%s\n' "$C_BOLD" "$C_CYN" "$C_OFF"
  printf '\n  logs         %s compose -p %s logs -f <service>\n' "${DOCKER[*]:-docker}" "$PROJECT_NAME"
  printf '  snapshot     %s compose -p %s logs --no-color --timestamps > ~/mercy-logs-$(date +%%F-%%H%%M).txt\n' "${DOCKER[*]:-docker}" "$PROJECT_NAME"
  printf '  health       ./setup.sh --stage=verify\n'
  printf '  restart one  %s compose -p %s restart <service>\n' "${DOCKER[*]:-docker}" "$PROJECT_NAME"
  printf '\n  Back the event up BEFORE anyone tidies anything away. Every\n'
  printf '  transcript, score and participant schema lives in these volumes:\n\n'
  printf '    for v in $(%s volume ls -q --filter name=%s_); do \\\n' "${DOCKER[*]:-docker}" "$PROJECT_NAME"
  printf '      %s run --rm -v "$v":/v -v "$PWD":/b alpine tar czf "/b/$v.tgz" -C /v . ; \\\n' "${DOCKER[*]:-docker}"
  printf '    done\n'
  printf '\n  %sdocker compose down -v deletes all of it. down (without -v) is the\n' "$C_YEL"
  printf '  safe one: it stops the stack and keeps every database.%s\n' "$C_OFF"

  if (( NEEDS_RELOGIN )); then
    printf '\n  %sThis run reached docker through sudo. Log out and back in for plain\n' "$C_DIM"
    printf '  "docker" to work as %s.%s\n' "$(id -un)" "$C_OFF"
  fi
  if [[ -n $ENV_BACKUP ]]; then
    printf '\n  %sThe previous .env is at %s%s\n' "$C_DIM" "$ENV_BACKUP" "$C_OFF"
  fi
  if [[ -n $LOG_FILE ]]; then
    printf '  %sTranscript: %s%s\n' "$C_DIM" "$LOG_FILE" "$C_OFF"
  fi
  printf '\n'
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

main() {
  parse_args "$@"
  setup_colors

  if [[ -z $REPO_DIR ]]; then
    REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
  else
    REPO_DIR="$(cd -- "$REPO_DIR" && pwd -P)"
  fi
  [[ -f "$REPO_DIR/docker-compose.yml" ]] || die "no docker-compose.yml in $REPO_DIR (pass --dir)"

  if [[ -z $LOG_FILE ]]; then LOG_FILE="$REPO_DIR/setup-$(date +%Y-%m-%d-%H%M).log"; fi
  # Keep the whole run, colour codes and all, out of scrollback and in a file.
  # The table the operator wants tomorrow is otherwise behind several hundred
  # lines of buildkit output.
  exec > >(tee -a "$LOG_FILE") 2>&1

  printf '%s%sMERCY: AI Judgement%s -- setup on %s\n' "$C_BOLD" "$C_CYN" "$C_OFF" "$(hostname)"
  printf '  checkout %s\n  stages   %s\n  log      %s\n' "$REPO_DIR" "$STAGES" "$LOG_FILE"

  resolve_sudo
  if have jq; then HAVE_JQ=1; fi
  resolve_docker

  # A default is not an instruction. Where .env already says something and the
  # operator did not override it on the command line, .env wins -- otherwise
  # preflight and verify would report on the deployment that was asked for
  # rather than the one actually running.
  adopt_from_env() {
    local flag_set="$1" var="$2" key="$3" current
    if (( flag_set )); then return 0; fi
    current="$(env_read "$key")"
    if [[ -n $current ]]; then printf -v "$var" '%s' "$current"; fi
  }
  if [[ -f "$(env_file)" ]]; then
    adopt_from_env "$PROVIDER_SET" LLM_PROVIDER  'MERCY_LLM_PROVIDER'
    adopt_from_env "$PROJECT_SET"  GCP_PROJECT   'GOOGLE_CLOUD_PROJECT'
    adopt_from_env "$LOCATION_SET" GCP_LOCATION  'GOOGLE_CLOUD_LOCATION'
    adopt_from_env "$MODEL_SET"    VERTEX_MODEL  'VERTEX_MODEL'
    adopt_from_env "$MINUTES_SET"  GAME_MINUTES  'GAME_MINUTES'
    adopt_from_env 0               SINGLE_PLAYER 'MERCY_SINGLE_PLAYER'
    info "read from .env: provider=$LLM_PROVIDER project=$GCP_PROJECT location=$GCP_LOCATION model=$VERTEX_MODEL minutes=$GAME_MINUTES"
    # .env is where a hand-edit lands, and an illegal provider crash-loops the
    # engine for the whole 15-minute readiness timeout before anyone sees why.
    validate_provider '.env'
  fi

  if wants 'preflight'; then
    stage_preflight
    # Installing Docker and running a six-minute build on a VM that cannot
    # finish is just a slower way to reach the same answer. Vertex, the access
    # scopes and the firewall are deliberately NOT in this gate: the stack
    # builds and runs without them, and they are fixable while it builds.
    if (( PREFLIGHT_FATAL )) && (( ! FORCE )) && { wants 'install' || wants 'build' || wants 'start'; }; then
      report
      printf '%s%sStopping here.%s %d preflight check(s) would make everything
' \
        "$C_BOLD" "$C_RED" "$C_OFF" "$PREFLIGHT_FATAL"
      printf '  after them pointless. Fix those and run this again -- nothing has
'
      printf '  been installed or changed on this VM.

'
      printf '  Go ahead anyway:          ./setup.sh --force
'
      printf '  Re-check, changing nothing: ./setup.sh --stage=preflight

'
      trap - ERR
      exit 1
    fi
  fi

  if wants 'install'; then stage_install; fi
  resolve_docker
  if (( ! ${#DOCKER[@]} )) && { wants 'configure' || wants 'build' || wants 'start' || wants 'verify'; }; then
    die "docker is not available. Run ./setup.sh --stage=install first."
  fi

  if wants 'configure'; then stage_configure; fi
  if wants 'build';     then stage_build; fi
  if wants 'start';     then stage_start; fi
  if wants 'verify';    then stage_verify; fi

  if [[ -z $EXTERNAL_IP ]]; then
    EXTERNAL_IP="$(metadata 'instance/network-interfaces/0/access-configs/0/external-ip')"
  fi
  if wants 'start'; then write_stamp; fi

  report
  # The ERR trap is for unexpected failures. A run that reported failures in its
  # own table has not crashed, so clear the trap first: otherwise the exit
  # status prints a panic underneath a perfectly orderly report.
  trap - ERR
  if (( FAILURES )); then exit 1; fi
  exit 0
}

main "$@"
