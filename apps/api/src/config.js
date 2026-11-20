import { z } from "zod";

const envSchema = z.object({
  HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  PORT: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535))
    .default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }).optional(),
  AMQP_URL: z.url({ protocol: /^amqps?$/ }).optional(),
  APP_ORIGIN: z
    .url({ protocol: /^https?$/ })
    .refine((value) => URL.canParse(value) && new URL(value).origin === value)
    .default("http://127.0.0.1:5173"),
  WRITE_RATE_LIMIT: z.coerce.number().int().min(1).max(100_000).default(60),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
});

export function readConfig(env) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const keys = result.error.issues.map((issue) => issue.path.join("."));
    throw new Error(`Invalid environment variables: ${keys.join(", ")}`);
  }
  return {
    host: result.data.HOST,
    port: result.data.PORT,
    logLevel: result.data.LOG_LEVEL,
    databaseUrl: result.data.DATABASE_URL,
    amqpUrl: result.data.AMQP_URL,
    appOrigin: result.data.APP_ORIGIN,
    writeRateLimit: result.data.WRITE_RATE_LIMIT,
    trustProxyHops: result.data.TRUST_PROXY_HOPS,
  };
}
