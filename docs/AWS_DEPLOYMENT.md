# AWS EC2 Deployment and Cost-Safety Runbook

## Target topology

Start with **one EC2 VM** and Docker Compose: reverse proxy, React static files, Express API/Socket.IO, RabbitMQ, Postgres, dispatcher, scheduler, 1–2 worker containers. Add Prometheus/Grafana only if memory budget permits; otherwise keep advanced monitoring on local benchmark machine. This does **not** provide host-level high availability.

AWS activation is deferred until the final release stage. The production Compose overlay and manually dispatched workflow are staged in the workspace. [Compose overlay](../infra/compose.prod.yaml) · [Deploy workflow](../.github/workflows/deploy.yml)

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
"${compose[@]}" config --quiet
"${compose[@]}" up -d --build --wait --wait-timeout 180
"${compose[@]}" ps
"${compose[@]}" logs --tail=100 api worker dispatcher scheduler
```

The versioned production overlay publishes only the Caddy ports 80 and 443. The default release omits optional observability services. Set a unique `GRAFANA_PASSWORD` if adding them, then inspect the rendered ports and keep the service on the private network. A rollback should preserve the database and broker volumes.

## Operational checks

- API/worker health and readiness; outbox age, stuck `RUNNING` leases, DLQ growth, disk use, Postgres free space, broker alarms, memory pressure.
- Use log rotation, retention policy, safe payload redaction, TLS renewal, patch cadence.
- Keep job handlers bounded in CPU/memory and job timeout. Avoid runtime code execution.
- For load tests, select a window with budget monitored and externally generated traffic permitted.

## Rollback / disaster recovery

If app release fails, keep last tagged image; deploy previous image while retaining compatible schema migrations. For destructive migrations use expand/contract approach. For host loss, recreate instance, restore DB backup and broker configuration, and reconcile outbox/job status. **Do not promise zero downtime or zero data loss from a single-host setup.**

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

## Cleanup steps

Terminate EC2 only after confirming data exports; then check EBS volumes/snapshots, public IPs, storage, DNS and other billable resources. Confirm Billing dashboard afterward.
