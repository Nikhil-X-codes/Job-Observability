import { lazy, Suspense, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
} from "react-router-dom";
import { io } from "socket.io-client";
import { api } from "./api.js";
import { JobDetail, Jobs, NewJob } from "./jobs.jsx";

const Overview = lazy(() =>
  import("./operator.jsx").then((page) => ({ default: page.Overview })),
);
const DeadLetters = lazy(() =>
  import("./operator.jsx").then((page) => ({ default: page.DeadLetters })),
);

function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      JobFlow
    </span>
  );
}

function SignIn({ onSuccess, initialError }) {
  const [error, setError] = useState(initialError);
  const [sending, setSending] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      onSuccess(
        await api("/auth/login", {
          method: "POST",
          body: Object.fromEntries(new FormData(event.currentTarget)),
        }),
      );
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSending(false);
    }
  }
  return (
    <main className="login">
      <Brand />
      <form className="login-form panel form" onSubmit={submit}>
        <h1>Sign in</h1>
        <label>
          Tenant <input name="tenant" defaultValue="demo" required />
        </label>
        <label>
          Email{" "}
          <input
            name="email"
            type="email"
            defaultValue="operator@example.test"
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password{" "}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={sending}>
          {sending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function useLive(sessionId) {
  const [revision, setRevision] = useState(0);
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!sessionId) return;
    const socket = io({ autoConnect: false });
    let refresh;
    const reconcile = () => {
      refresh ??= setTimeout(() => {
        refresh = undefined;
        setRevision((value) => value + 1);
      }, 200);
    };
    const reconcileVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine)
        reconcile();
    };
    const fallback = setInterval(reconcileVisible, 15_000);
    document.addEventListener("visibilitychange", reconcileVisible);
    window.addEventListener("online", reconcileVisible);
    const disconnected = () => setLive(false);
    socket.on("connect", () => {
      setLive(true);
      reconcile();
    });
    socket.on("disconnect", disconnected);
    socket.on("connect_error", disconnected);
    socket.on("job:updated", reconcile);
    socket.on("queue:summary", reconcile);
    socket.connect();
    return () => {
      clearTimeout(refresh);
      clearInterval(fallback);
      document.removeEventListener("visibilitychange", reconcileVisible);
      window.removeEventListener("online", reconcileVisible);
      socket.removeAllListeners();
      socket.disconnect();
      setLive(false);
    };
  }, [sessionId]);
  return { revision, live };
}

export function App() {
  const [session, setSession] = useState(undefined);
  const [error, setError] = useState("");
  const { revision, live } = useLive(session?.id);
  useEffect(() => {
    const expired = () => setSession(null);
    window.addEventListener("jobflow:session-ended", expired);
    return () => window.removeEventListener("jobflow:session-ended", expired);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void api("/me", { signal: controller.signal }).then(
      (user) => setSession(user),
      (failure) => {
        if (controller.signal.aborted) return;
        if (failure.status !== 401) setError(failure.message);
        setSession(null);
      },
    );
    return () => controller.abort();
  }, []);
  async function signOut() {
    try {
      await api("/auth/logout", { method: "POST" });
      setError("");
      setSession(null);
    } catch (failure) {
      setError(failure.message);
    }
  }

  if (session === undefined)
    return (
      <main className="login" role="status">
        Checking session…
      </main>
    );
  if (!session)
    return (
      <SignIn
        initialError={error}
        onSuccess={(user) => {
          setError("");
          setSession(user);
        }}
      />
    );
  const admin = session.role === "ADMIN";
  return (
    <BrowserRouter>
      <div className="shell">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <aside className="sidebar">
          <NavLink className="home-link" to={admin ? "/overview" : "/jobs"}>
            <Brand />
          </NavLink>
          <nav aria-label="Main">
            {admin && <NavLink to="/overview">Overview</NavLink>}
            <NavLink to="/jobs">Jobs</NavLink>
            {admin && <NavLink to="/dead-letters">Dead letters</NavLink>}
          </nav>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <span className="connection" data-live={live} role="status">
              {live ? "Live" : "Reconnecting"}
            </span>
            <div className="account">
              <span className="account-email" title={session.email}>
                {session.email}
              </span>
              <button onClick={signOut}>Sign out</button>
            </div>
          </header>
          <main className="dashboard" id="main-content" tabIndex={-1}>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <Suspense fallback={<p role="status">Loading…</p>}>
              <Routes>
                <Route
                  path="/"
                  element={
                    <Navigate replace to={admin ? "/overview" : "/jobs"} />
                  }
                />
                <Route path="/jobs" element={<Jobs revision={revision} />} />
                <Route path="/jobs/new" element={<NewJob />} />
                <Route
                  path="/jobs/:id"
                  element={<JobDetail revision={revision} />}
                />
                <Route
                  path="/overview"
                  element={
                    admin ? (
                      <Overview revision={revision} />
                    ) : (
                      <Navigate replace to="/jobs" />
                    )
                  }
                />
                <Route
                  path="/dead-letters"
                  element={
                    admin ? (
                      <DeadLetters revision={revision} />
                    ) : (
                      <Navigate replace to="/jobs" />
                    )
                  }
                />
                <Route path="*" element={<Navigate replace to="/jobs" />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
