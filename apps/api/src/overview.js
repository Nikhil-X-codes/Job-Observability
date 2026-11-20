const statuses = [
  "PENDING",
  "QUEUED",
  "RUNNING",
  "RETRY_WAIT",
  "COMPLETED",
  "DEAD",
  "CANCELLED",
];

export async function readOverview(db, tenantId) {
  const at = new Date();
  const [groups, completedLastMinute] = await Promise.all([
    db.job.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { _all: true },
    }),
    db.job.count({
      where: {
        tenantId,
        status: "COMPLETED",
        finishedAt: { gte: new Date(at.getTime() - 60_000) },
      },
    }),
  ]);
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  for (const group of groups) counts[group.status] = group._count._all;
  return { counts, completedLastMinute, activeWorkers: null, at };
}
