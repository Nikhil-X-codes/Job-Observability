import { Server } from "socket.io";
import { createSessions } from "./auth.js";
import { readOverview } from "./overview.js";

export function attachRealtime(server, { db, appOrigin, logger }) {
  const sessions = createSessions(db, appOrigin);
  const io = new Server(server, {
    serveClient: false,
    maxHttpBufferSize: 8192,
    allowRequest: (request, done) =>
      done(
        null,
        !request.headers.origin || request.headers.origin === appOrigin,
      ),
  });
  io.use(async (socket, next) => {
    try {
      const user = await sessions.findUser(socket.request.headers.cookie);
      if (!user) return next(new Error("Sign in required"));
      socket.data.tenantId = user.tenantId;
      next();
    } catch {
      next(new Error("Session unavailable"));
    }
  });
  io.on("connection", (socket) =>
    socket.join(`tenant:${socket.data.tenantId}`),
  );

  const cursor = new Map();
  async function publishChanges() {
    const tenants = new Set();
    const sessionsByHeader = new Map();
    for (const socket of io.sockets.sockets.values()) {
      const cookie = socket.request.headers.cookie;
      if (!sessionsByHeader.has(cookie))
        sessionsByHeader.set(cookie, sessions.findUser(cookie));
      const user = await sessionsByHeader.get(cookie);
      if (user?.tenantId === socket.data.tenantId) tenants.add(user.tenantId);
      else socket.disconnect(true);
    }
    for (const tenantId of cursor.keys()) {
      if (!tenants.has(tenantId)) cursor.delete(tenantId);
    }
    for (const tenantId of tenants) {
      const previous = cursor.get(tenantId);
      const changes = await db.job.findMany({
        where: {
          tenantId,
          OR: [
            {
              updatedAt: {
                gt: previous?.updatedAt ?? new Date(Date.now() - 2000),
              },
            },
            ...(previous
              ? [{ updatedAt: previous.updatedAt, id: { gt: previous.id } }]
              : []),
          ],
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: 100,
        select: {
          id: true,
          status: true,
          updatedAt: true,
          attemptNumber: true,
        },
      });
      if (!changes.length) continue;
      const room = io.to(`tenant:${tenantId}`);
      for (const { id, ...job } of changes)
        room.emit("job:updated", { jobId: id, ...job });
      const { counts, at } = await readOverview(db, tenantId);
      room.emit("queue:summary", {
        queued: counts.QUEUED,
        running: counts.RUNNING,
        retryWait: counts.RETRY_WAIT,
        dead: counts.DEAD,
        completed: counts.COMPLETED,
        at,
      });
      cursor.set(tenantId, changes.at(-1));
    }
  }

  let checking;
  const timer = setInterval(() => {
    checking ??= publishChanges()
      .catch(() => logger.warn("Realtime status refresh failed"))
      .finally(() => {
        checking = undefined;
      });
  }, 1000);
  timer.unref();

  return async () => {
    clearInterval(timer);
    await checking;
    await io.close();
  };
}
