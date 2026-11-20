const retryable = new Set(["TRANSIENT", "TIMEOUT", "LEASE_EXPIRED"]);

export function retryDelay(
  { attemptNo, maxAttempts },
  errorCode,
  random = Math.random,
) {
  if (!retryable.has(errorCode) || attemptNo >= maxAttempts) return null;
  return Math.min(
    30_000,
    500 * 2 ** (attemptNo - 1) + Math.floor(random() * 250),
  );
}
