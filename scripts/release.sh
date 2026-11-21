#!/usr/bin/env bash
set -euo pipefail

: "${JOBFLOW_PRODUCTION_ENV_FILE:?Set the path to the production environment file}"
test -r "$JOBFLOW_PRODUCTION_ENV_FILE"
mode=${1:-deploy}
project=${JOBFLOW_COMPOSE_PROJECT:-jobflow-prod}
replicas=${JOBFLOW_WORKER_REPLICAS:-1}
[[ $replicas =~ ^[1-9][0-9]*$ ]]

compose=(docker compose --env-file "$JOBFLOW_PRODUCTION_ENV_FILE" -p "$project"
  -f infra/compose.yaml -f infra/compose.prod.yaml)

if [[ $mode == deploy ]]; then
  export JOBFLOW_RELEASE_TAG
  JOBFLOW_RELEASE_TAG=$(git rev-parse HEAD)
  if [[ ${JOBFLOW_ENABLE_DELIVERY:-0} == 1 ]]; then
    compose+=(-f infra/compose.delivery.yaml)
  fi
  "${compose[@]}" config --quiet
  running_api=$("${compose[@]}" ps -q api)
  if [[ -n $running_api ]]; then
    previous=$(docker inspect --format '{{.Config.Image}}' "$running_api")
    printf 'Current API image: %s\n' "$previous"
  fi
  "${compose[@]}" build
  if [[ ${JOBFLOW_ENABLE_DELIVERY:-0} == 1 ]]; then
    "${compose[@]}" run --rm -T --no-deps worker node --input-type=module -e \
      "import { createGateway } from './services/worker/src/gateway.js'; if (!createGateway(process.env)) process.exit(1)"
  fi
  "${compose[@]}" up -d --no-build --wait --wait-timeout 180 --scale "worker=$replicas"
elif [[ $mode == rollback && ${2:-} =~ ^[a-f0-9]{40}$ ]]; then
  export JOBFLOW_RELEASE_TAG=$2
  "${compose[@]}" config --quiet
  if ! git diff --quiet "$JOBFLOW_RELEASE_TAG" HEAD -- infra/compose.yaml infra/compose.prod.yaml infra/caddy/Caddyfile.prod; then
    printf 'Compose or Caddy configuration differs. Use the saved release checkout and runbook.\n' >&2
    exit 1
  fi
  running_api=$("${compose[@]}" ps -q api)
  if [[ -n $running_api ]]; then
    mode_env=$(docker inspect --format '{{range .Config.Env}}{{$key := index (split . "=") 0}}{{if or (eq $key "DELIVERY_TENANT_ID") (eq $key "DELIVERY_ACCEPT_NEW")}}{{println .}}{{end}}{{end}}' "$running_api")
    if grep -q '^DELIVERY_TENANT_ID=.' <<< "$mode_env" && ! grep -qx 'DELIVERY_ACCEPT_NEW=0' <<< "$mode_env"; then
      printf 'Disable external delivery admission and drain its jobs before rollback.\n' >&2
      exit 1
    fi
  fi
  pending=$("${compose[@]}" exec -T postgres psql -XAt -v ON_ERROR_STOP=1 -U jobflow -d jobflow -c \
    "SELECT count(*) FROM jobs WHERE type::text IN ('SEND_EMAIL','DELIVER_WEBHOOK') AND status IN ('PENDING','QUEUED','RUNNING','RETRY_WAIT')")
  if [[ $pending != 0 ]]; then
    printf 'External delivery jobs still require reconciliation.\n' >&2
    exit 1
  fi
  if ! git cat-file -e "$JOBFLOW_RELEASE_TAG:packages/db/prisma/migrations/20261121000000_external_delivery/migration.sql" 2>/dev/null; then
    deliveries=$("${compose[@]}" exec -T postgres psql -XAt -v ON_ERROR_STOP=1 -U jobflow -d jobflow -c \
      "SELECT count(*) FROM jobs WHERE type::text IN ('SEND_EMAIL','DELIVER_WEBHOOK')")
    if [[ $deliveries != 0 ]]; then
      printf 'That release predates external delivery and cannot safely read its history.\n' >&2
      exit 1
    fi
  fi
  for image in jobflow-api jobflow-processing jobflow-web; do
    docker image inspect "$image:$JOBFLOW_RELEASE_TAG" >/dev/null
  done
  "${compose[@]}" up -d --no-build --pull never --no-deps --wait --wait-timeout 180 \
    --scale "worker=$replicas" api dispatcher scheduler worker web
else
  printf 'Usage: bash scripts/release.sh deploy | rollback <40-character release SHA>\n' >&2
  exit 2
fi

"${compose[@]}" exec -T api node -e \
  "fetch('http://127.0.0.1:3000/health/ready', {signal: AbortSignal.timeout(5000)}).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
printf 'JobFlow release %s passed API readiness.\n' "$JOBFLOW_RELEASE_TAG"
