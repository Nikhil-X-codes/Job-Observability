import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { HttpError } from "./http-errors.js";
import { verifyPassword } from "./passwords.js";

const sessionMs = 8 * 60 * 60 * 1000;
const publicUser = { id: true, tenantId: true, email: true, role: true };
export const tenantSlug = z.string().regex(/^[a-z0-9-]{1,64}$/);
export const emailAddress = z
  .email()
  .max(254)
  .transform((email) => email.toLowerCase());
const loginBody = z.strictObject({
  tenant: tenantSlug,
  email: emailAddress,
  password: z.string().min(1).max(256),
});

function digest(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessions(db, appOrigin) {
  const secure = appOrigin.startsWith("https://");
  const cookie = secure ? "__Host-jobflow.sid" : "jobflow.sid";
  const options = { httpOnly: true, sameSite: "strict", secure, path: "/" };

  function readCookie(header) {
    const values = (header ?? "")
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith(`${cookie}=`))
      .map((entry) => entry.slice(cookie.length + 1));
    return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0])
      ? values[0]
      : null;
  }

  async function findUser(header) {
    const token = readCookie(header);
    if (!token) return null;
    const session = await db.session.findUnique({
      where: { tokenHash: digest(token) },
      select: { expiresAt: true, user: { select: publicUser } },
    });
    return session?.expiresAt > new Date() ? session.user : null;
  }

  async function authenticate(request, _response, next) {
    const user = await findUser(request.headers.cookie);
    if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in required");
    request.user = user;
    next();
  }

  async function login(request, response) {
    const credentials = loginBody.safeParse(request.body);
    if (!credentials.success) {
      throw new HttpError(
        400,
        "INVALID_CREDENTIALS",
        "Invalid sign-in request",
      );
    }
    const { tenant, email, password } = credentials.data;
    const account = await db.user.findFirst({
      where: { email, tenant: { slug: tenant } },
      select: { ...publicUser, passwordHash: true },
    });
    if (!(await verifyPassword(password, account?.passwordHash))) {
      throw new HttpError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid sign-in credentials",
      );
    }
    const { id, tenantId, role } = account;
    const previous = readCookie(request.headers.cookie);
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    await db.$transaction([
      db.session.deleteMany({
        where: {
          OR: [
            { userId: id, expiresAt: { lte: now } },
            ...(previous ? [{ tokenHash: digest(previous) }] : []),
          ],
        },
      }),
      db.session.create({
        data: {
          tokenHash: digest(token),
          userId: id,
          expiresAt: new Date(now.getTime() + sessionMs),
        },
      }),
    ]);
    response.cookie(cookie, token, { ...options, maxAge: sessionMs });
    response.json({ id, tenantId, email, role });
  }

  async function logout(request, response) {
    const token = readCookie(request.headers.cookie);
    if (token)
      await db.session.deleteMany({ where: { tokenHash: digest(token) } });
    response.clearCookie(cookie, options).status(204).end();
  }

  return { authenticate, findUser, login, logout };
}
