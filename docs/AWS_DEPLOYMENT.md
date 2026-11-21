# AWS EC2 Deployment and Cost-Safety Runbook

## Target topology

Start with **one EC2 VM** and Docker Compose: reverse proxy, React static files, Express API/Socket.IO, RabbitMQ, Postgres, dispatcher, scheduler, 1–2 worker containers. Add Prometheus/Grafana only if memory budget permits; otherwise keep advanced monitoring on local benchmark machine. This does **not** provide host-level high availability.

The demo is live on a single EC2 instance in `ap-southeast-2`. Phase 08 tracks the outstanding operational checks. [Live demo](https://nikhil-jobflow.duckdns.org/) · [Phase 08](phases/PHASE_08_AWS_RELEASE.md) · [Compose overlay](../infra/compose.prod.yaml) · [Manual deploy workflow](../.github/workflows/deploy.yml)

## Free Tier warning (as of project planning in Nov 2026)

AWS pricing, Free Plan eligibility, available instance types, credits, duration, regional taxes and transfer rates can change. Check the current official AWS Free Tier and EC2 pricing pages **in your own account and region** before launching. Do not treat "$200 credit" or "6 months" as an entitlement without verifying your plan. Cost estimate is **not** a spending limit.

## Cost checklist before creating resources

- [ ] Confirm account is Free Plan or Paid Plan and actual remaining credits.
- [ ] Choose one region; price VM, EBS volume, public IPv4, data transfer, snapshots, other services.
- [ ] Configure AWS Budgets alert at low spend and Cost Anomaly Detection as available; alerts do NOT automatically stop billing.
- [ ] Set resource tags (`Project=JobFlow`, `Environment=demo`).
- [ ] Avoid NAT Gateway, load balancer, EKS, managed MQ/RDS for V1.
- [ ] Decide a shutdown date and how volumes/backups will be handled.

## Size choices (validate current region prices)

- `t3.micro` (1 GiB RAM): too constrained for full services; API-only exploration.
- `t3.small` (2 GiB RAM): possible minimal app with strict memory limits; no guarantee all monitoring containers fit.
- 4 GiB+ instance: better for complete single-host stack, but verify Free Tier eligibility and actual hourly cost before choosing.
- **Benchmarks:** run on separately documented sufficiently provisioned machine; don't equate poor tiny-VM throughput with software limit.

## Provisioning plan

1. Create EC2 Linux VM, EBS volume with explicit size and snapshot strategy, SSH key or SSM session access.
2. Security group inbound: 80/443 only from internet for public demo; SSH only from trusted IP if used. Never publicly open 5432 (Postgres), 5672/15672 (RabbitMQ), 9090 (Prometheus), 3000 (Grafana).
3. Update OS, install Docker Engine + Compose plugin, use least-privilege system account. Pin images and protect Docker socket.
4. Configure domain DNS, Caddy automatic TLS. If no domain, document alternative HTTPS approach; do not expose login over plain HTTP.
5. Put application secrets in secure deployment environment/SSM; restrict file permissions. Use unique database and RabbitMQ credentials.
6. Start DB and RabbitMQ with durable volumes/healthchecks; apply migrations as a controlled release step.
7. Start API, dispatcher, scheduler, then workers and web proxy; verify readiness and Socket.IO reconnect.
8. Verify HTTPS, auth, job create→complete, retry, DLQ, metrics and logs.
9. Backup DB and test restore; document retention and recovery point limitations.
10. Set GitHub Actions deploy as **manual environment-approved step** (SSH/SSM or protected runner). Never hardcode AWS keys in repository.

## Production Compose commands

After AWS release approval, save the filled [production environment template](../infra/production.env.example) outside the checkout with restricted permissions. Set `JOBFLOW_PRODUCTION_ENV_FILE` to that path. On the release host, run:

```bash
export JOBFLOW_RELEASE_TAG="$(git rev-parse HEAD)"
compose=(docker compose --env-file "$JOBFLOW_PRODUCTION_ENV_FILE" -p jobflow-prod -f infra/compose.yaml -f infra/compose.prod.yaml)
bash scripts/release.sh deploy
"${compose[@]}" ps
"${compose[@]}" logs --tail=100 api worker dispatcher scheduler
```

The versioned production overlay publishes only the Caddy ports 80 and 443. The default release omits optional observability services. Set a unique `GRAFANA_PASSWORD` if adding them, then inspect the rendered ports and keep the service on the private network. A rollback should preserve the database and broker volumes.

### Update the existing EC2 demo

Push the tested change, wait for CI to pass, and record that commit's full SHA. On the existing EC2 host, take the database backup described below and preserve the current images. Use the same checkout, environment file, and Compose project as the running demo so it keeps the existing volumes.

```bash
git fetch origin
release=PASTE_FULL_SHA_FROM_PASSING_CI
git switch --detach "$release"
export JOBFLOW_PRODUCTION_ENV_FILE=/path/to/existing/jobflow-production.env
bash scripts/release.sh deploy
```

The script prints the current API image before updating and checks the new API's internal readiness after Compose starts. It defaults to one worker. Set `JOBFLOW_WORKER_REPLICAS` if the deployment has a different tested scale. From your own machine, open the deployed HTTPS URL, sign in, and submit a report job. Confirm it completes and that its attempt and event history are visible. Open **p95 dispatcher stage duration** in private Grafana, if configured. Test forced worker loss, broker reconstruction, and restore on a disposable stack. [Live demo](https://nikhil-jobflow.duckdns.org/)

### Enable the external delivery gateway

Verify both providers from an isolated local stack before enabling delivery on AWS. Start PostgreSQL and RabbitMQ in Compose, migrate and seed a disposable database, then set `DELIVERY_TENANT_ID`, `RESEND_API_KEY`, and `WEBHOOK_SITE_URL` in an ignored local `.env` or protected runtime environment. Obtain the approved tenant UUID from `/api/v1/me`. `RESEND_FROM` defaults to `onboarding@resend.dev`. Use a Resend sending key and the private Webhook.site URL. The key and URL are worker secrets. Start the API, web, worker, dispatcher, and scheduler using the `dev:*` workspace scripts.

Use **New job** in the configured tenant's admin account. Submit `jobflow-email-success-001` with `delivered` and `jobflow-email-bounce-001` with `bounced`. In Resend's **Emails** dashboard, open the matching sends using the fixture subject, recipient, and submission time. Verify **Delivered** and **Bounced** in their event timelines, and record each outcome and timestamp with its JobFlow job ID. Use the same dashboard check for **Complained** if you run the complaint fixture. JobFlow completion records provider acceptance. Retry uses the same `Idempotency-Key: jobflow/<job-id>` and payload, with a 23-hour limit measured from eligibility. Keep the Resend account and sender consistent while jobs are pending. [Resend sandbox recipients](https://resend.com/docs/dashboard/emails/send-test-emails) · [Resend delivery timeline](https://resend.com/guides/email/users-never-got-login-code) · [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)

For Webhook.site, use `jobflow-webhook-success-001` with destination ID `webhook-site` to verify capture. `jobflow-webhook-retry-001` requests a `503` after capture to exercise the duplicate guard. Expect one captured synthetic request and a JobFlow dead letter. A timeout or other ambiguous result requires checking the receiver before submitting a new job. Reconcile any external jobs restored from a backup before enabling the worker's delivery configuration. [Webhook.site response testing](https://docs.webhook.site/api/requests.html#capture-request)

After sandbox verification and release approval, configure the provider settings in the protected production environment file. Sign in to the AWS demo and obtain that database's tenant UUID from `/api/v1/me`. Keep the production database and broker connection settings. Enable the delivery overlay on EC2:

```bash
JOBFLOW_ENABLE_DELIVERY=1 bash scripts/release.sh deploy
```

For a demo, show the Resend event or Webhook.site capture beside JobFlow's job status and attempt history. Show dispatcher stage timings in private Grafana and use the local recovery rehearsal for the injected failure walkthrough.

## Operational checks

- API/worker health and readiness; outbox age, stuck `RUNNING` leases, DLQ growth, disk use, Postgres free space, broker alarms, memory pressure.
- Use log rotation, retention policy, safe payload redaction, TLS renewal, patch cadence.
- Keep job handlers bounded in CPU/memory and job timeout. Avoid runtime code execution.
- For load tests, select a window with budget monitored and externally generated traffic permitted.

## Rollback / disaster recovery

If an app release fails, identify the previous full SHA from the prior API image printed by deploy. Keep its tagged app images and confirm that the previous code is compatible with the current schema. If external delivery was enabled, pause external submissions while keeping the gateway workers enabled, then drain or reconcile outstanding jobs before rollback.

```bash
# Only when external delivery is already enabled
JOBFLOW_ENABLE_DELIVERY=1 JOBFLOW_DELIVERY_ACCEPT_NEW=0 bash scripts/release.sh deploy
previous=PASTE_PREVIOUS_FULL_SHA
bash scripts/release.sh rollback "$previous"
```

Rollback reuses the retained application images and keeps the running PostgreSQL and RabbitMQ services and their named volumes. It checks for compatible base Compose and Caddy files and unfinished external jobs. Once external delivery history exists, use a release that understands the new job types. If infrastructure configuration changed, use the saved release checkout with its matching configuration. Use expand/contract for destructive migrations. The single-host deployment is unavailable during host recovery, and transactions after the last backup may be lost.

For a configuration change, verify the previous release can read the current schema and complete any outstanding delivery reconciliation first. From the existing checkout, use the previous release's Compose and Caddy files with the same environment file, project, and retained image tags:

```bash
previous=PASTE_PREVIOUS_FULL_SHA
previous_checkout="$HOME/jobflow-release-$previous"
git worktree add --detach "$previous_checkout" "$previous"
cd "$previous_checkout"
export JOBFLOW_RELEASE_TAG="$previous"
docker compose --env-file "$JOBFLOW_PRODUCTION_ENV_FILE" -p jobflow-prod \
  -f infra/compose.yaml -f infra/compose.prod.yaml \
  up -d --no-build --pull never --no-deps --wait --wait-timeout 180 \
  --scale worker=1 api dispatcher scheduler worker web
```

Keep the previous checkout while Caddy uses its bind-mounted configuration. Verify HTTPS, sign-in, and a demo job completion after rollback.

For the backup exercise, save a custom-format PostgreSQL dump and restore it into a disposable database. Run these commands on the approved release host with the production Compose arguments defined above:

```bash
umask 077
backup="jobflow-$(date -u +%Y%m%dT%H%M%SZ).dump"
"${compose[@]}" exec -T postgres sh -c 'pg_dump --format=custom --username="$POSTGRES_USER" "$POSTGRES_DB"' > "$backup"
restore_db="jobflow_restore_$(date -u +%Y%m%d%H%M%S)"
"${compose[@]}" exec -T postgres createdb -U jobflow "$restore_db"
"${compose[@]}" exec -T postgres pg_restore --exit-on-error -U jobflow -d "$restore_db" < "$backup"
"${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U jobflow -d "$restore_db" \
  -c 'SELECT status, count(*) FROM jobs GROUP BY status ORDER BY status;'
```

Keep the dump in approved encrypted storage. Record the dump and restore timestamps, audit job counts and sample job history in the restored database, and remove the disposable database after verification. Keep production services pointed at the production database throughout the exercise.

### Recover when rebuilding RabbitMQ

Restore PostgreSQL and prepare a fresh RabbitMQ volume or vhost. With the API, dispatcher, workers, and scheduler stopped on the recovery stack, set `restore_db` to the restored database. Verify the Compose project and database name before applying the repair:

```bash
"${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U jobflow -d "$restore_db" \
  < infra/postgres/rearm-queued-dispatches.sql
```

Record the row count printed by PostgreSQL. A second run before starting application services should update zero rows. The repair makes the current confirmed dispatch of each unclaimed `QUEUED` job available for publication again. Start the recovery stack using the restored database and replacement broker. Watch the dispatcher confirm those publications and the workers drain due jobs. The scheduler handles expired `RUNNING` leases using the existing attempt cap and retry policy. Compare restored job and effect counts with the backup evidence, then submit a new demo job and verify its completion.

The restore point bounds the recovered database history. If an external provider accepted an effect after the backup timestamp, reconcile that provider's records before resuming affected handlers. [Rearm SQL](../infra/postgres/rearm-queued-dispatches.sql) · [Failure model](ARCHITECTURE.md#failure-matrix)

## Cleanup steps

Terminate EC2 only after confirming data exports; then check EBS volumes/snapshots, public IPs, storage, DNS and other billable resources. Confirm Billing dashboard afterward.
