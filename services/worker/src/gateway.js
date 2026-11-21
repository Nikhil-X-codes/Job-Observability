export class DeliveryError extends Error {
  constructor(code) {
    super("External delivery did not complete");
    this.code = code;
  }
}

const resendEndpoint = new URL("https://api.resend.com/emails");
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const emailFixtures = new Set([
  "jobflow-email-success-001",
  "jobflow-email-bounce-001",
]);
const testRecipients = {
  delivered: "delivered@resend.dev",
  bounced: "bounced@resend.dev",
  complained: "complained@resend.dev",
};
const successWebhook = "jobflow-webhook-success-001";
const retryWebhook = "jobflow-webhook-retry-001";
const resendRetryWindowMs = 23 * 60 * 60 * 1000;

export function createGateway(env, request = fetch) {
  const {
    WEBHOOK_SITE_URL: address,
    RESEND_API_KEY: token,
    RESEND_FROM: sender = "onboarding@resend.dev",
    DELIVERY_TENANT_ID: tenantId,
  } = env;
  if (!address && !token && !tenantId) return undefined;
  const url = URL.canParse(address) ? new URL(address) : null;
  if (
    url?.origin !== "https://webhook.site" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !uuid.test(url.pathname.slice(1).replace(/\/$/, "")) ||
    !/^re_[A-Za-z0-9_-]{8,509}$/.test(token ?? "") ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender) ||
    !uuid.test(tenantId ?? "")
  ) {
    throw new Error("Invalid external delivery configuration");
  }
  url.pathname = url.pathname.replace(/\/$/, "");

  return async (
    { type, payload, jobId, tenantId: owner, runAt, attemptNo },
    signal,
  ) => {
    if (owner !== tenantId) throw new DeliveryError("PERMANENT");
    const email = type === "SEND_EMAIL";
    let endpoint;
    let body;
    const headers = {
      "Content-Type": "application/json",
      "Idempotency-Key": `jobflow/${jobId}`,
    };
    if (email) {
      const dueAt = Number(runAt);
      if (
        !emailFixtures.has(payload.templateId) ||
        !Object.hasOwn(testRecipients, payload.recipientId) ||
        !Number.isFinite(dueAt) ||
        Date.now() - dueAt >= resendRetryWindowMs
      ) {
        throw new DeliveryError("PERMANENT");
      }
      endpoint = resendEndpoint;
      headers.Authorization = `Bearer ${token}`;
      body = {
        from: sender,
        to: [testRecipients[payload.recipientId]],
        subject: `JobFlow sandbox ${payload.templateId}`,
        text: "Synthetic JobFlow email sandbox fixture.",
        tags: [{ name: "fixture", value: payload.templateId }],
      };
    } else {
      if (
        type !== "DELIVER_WEBHOOK" ||
        attemptNo !== 1 ||
        payload.destinationId !== "webhook-site" ||
        ![successWebhook, retryWebhook].includes(payload.eventId)
      ) {
        throw new DeliveryError("PERMANENT");
      }
      endpoint = new URL(url);
      if (payload.eventId === retryWebhook) endpoint.pathname += "/503";
      body = { fixtureId: payload.eventId, synthetic: true };
    }
    let response;
    try {
      response = await request(endpoint, {
        method: "POST",
        redirect: "manual",
        signal,
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      throw new DeliveryError(email ? "TRANSIENT" : "PERMANENT");
    }
    if (email && (response.ok || response.status === 409)) {
      const result = await response.json().catch(() => null);
      if (response.ok)
        return {
          accepted: true,
          ...(uuid.test(result?.id ?? "") && { providerId: result.id }),
        };
      throw new DeliveryError(
        result?.name === "concurrent_idempotent_requests"
          ? "TRANSIENT"
          : "PERMANENT",
      );
    }
    await response.body?.cancel().catch(() => {});
    if (response.ok) return { accepted: true };
    const retryable =
      email &&
      ([408, 425, 429].includes(response.status) || response.status >= 500);
    throw new DeliveryError(retryable ? "TRANSIENT" : "PERMANENT");
  };
}
