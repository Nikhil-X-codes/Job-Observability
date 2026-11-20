import { PrismaPg } from "@prisma/adapter-pg";
import generated from "../generated/client/index.js";

const { PrismaClient } = generated;

export function createDatabase(connectionString) {
  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 2500,
    statement_timeout: 5000,
    query_timeout: 6000,
    // Prisma serializes DateTime values as UTC. Keep PostgreSQL casts in UTC too.
    onConnect: (connection) => connection.query("SET TIME ZONE 'UTC'"),
  });
  return new PrismaClient({ adapter });
}
