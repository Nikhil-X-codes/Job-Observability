import { useEffect, useState } from "react";

export async function api(path, { body, signal, ...request } = {}) {
  const timeout = AbortSignal.timeout(8000);
  const response = await fetch(`/api/v1${path}`, {
    ...request,
    credentials: "same-origin",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: {
      ...(body && { "Content-Type": "application/json" }),
      ...request.headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return undefined;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login") {
      window.dispatchEvent(new Event("jobflow:session-ended"));
    }
    const error = new Error(data?.error?.message ?? "Request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

export function useApi(path, revision) {
  const [state, setState] = useState({});
  useEffect(() => {
    const controller = new AbortController();
    void api(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setState({ path, data });
      },
      (error) => {
        if (!controller.signal.aborted)
          setState({ path, error: error.message });
      },
    );
    return () => controller.abort();
  }, [path, revision]);
  return state.path === path ? state : {};
}

const date = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
export const showTime = (value) => (value ? date.format(new Date(value)) : "—");
export const label = (value) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
