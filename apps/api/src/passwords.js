import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const digest = await derive(password, salt, 64, parameters);
  return `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`;
}

const dummyHash = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;

export async function verifyPassword(password, storedHash) {
  const usable = /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/.test(storedHash ?? "");
  const [, saltHex, digestHex] = (usable ? storedHash : dummyHash).split(":");
  const expected = Buffer.from(digestHex, "hex");
  const actual = await derive(
    password,
    Buffer.from(saltHex, "hex"),
    64,
    parameters,
  );
  const matches = timingSafeEqual(actual, expected);
  return usable && matches;
}
