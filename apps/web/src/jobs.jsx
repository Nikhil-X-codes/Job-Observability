import { useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api, label, showTime, useApi } from "./api.js";

const payloadFields = {
  GENERATE_REPORT: [["reportId", "Report ID"]],
  SIMULATE_EMAIL: [
    ["templateId", "Template ID"],
    ["recipientId", "Demo recipient ID"],
  ],
  MOCK_WEBHOOK: [["eventId", "Mock event ID"]],
};
const statuses = [
  "PENDING",
  "QUEUED",
  "RUNNING",
  "RETRY_WAIT",
  "COMPLETED",
  "DEAD",
  "CANCELLED",
];

export function Status({ value }) {
  return (
    <span className="job-status" data-status={value}>
      {label(value)}
    </span>
  );
}

export function ResourceMessage({ result, empty }) {
  if (result.error)
    return (
      <p className="error" role="alert">
        {result.error}
      </p>
    );
  if (!result.data)
    return (
      <p className="resource-state" role="status">
        Loading…
      </p>
    );
  if (empty) return <p className="resource-state">{empty}</p>;
  return null;
}

export function Pager({ cursors, next, update }) {
  if (!next && cursors.length === 1) return null;
  return (
    <nav className="row pager" aria-label="Pagination">
      <span className="muted">Page {cursors.length}</span>
      <button
        type="button"
        disabled={cursors.length === 1}
        onClick={() => update(cursors.slice(0, -1))}
      >
        Previous
      </button>
      <button
        type="button"
        disabled={!next}
        onClick={() => update([...cursors, next])}
      >
        Next
      </button>
    </nav>
  );
}

export function Jobs({ revision }) {
  const [filters, setFilters] = useSearchParams();
  const status = filters.get("status") ?? "";
  const type = filters.get("type") ?? "";
  const filterKey = `${status}:${type}`;
  const [page, setPage] = useState(null);
  const cursors = page?.key === filterKey ? page.cursors : [""];
  function changeFilter(name, value) {
    const next = new URLSearchParams(filters);
    if (value) next.set(name, value);
    else next.delete(name);
    setPage(null);
    setFilters(next);
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({
    status,
    type,
    cursor: cursors.at(-1),
  })) {
    if (value) query.set(key, value);
  }
  const result = useApi(`/jobs?${query}`, revision);
  const { data } = result;
  const listUrl = filters.size ? `/jobs?${filters}` : "/jobs";
  return (
    <>
      <div className="heading">
        <h1>Jobs</h1>
        <Link className="primary" to="/jobs/new">
          <span className="plus" aria-hidden="true">
            +
          </span>
          New job
        </Link>
      </div>
      <section className="panel table-panel" aria-label="Job list">
        <div className="row filters">
          <label>
            <span id="status-filter-label">Status</span>
            <select
              aria-labelledby="status-filter-label"
              value={status}
              onChange={(event) => changeFilter("status", event.target.value)}
            >
              <option value="">All statuses</option>
              {statuses.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span id="type-filter-label">Type</span>
            <select
              aria-labelledby="type-filter-label"
              value={type}
              onChange={(event) => changeFilter("type", event.target.value)}
            >
              <option value="">All types</option>
              {Object.keys(payloadFields).map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          {(status || type) && (
            <button
              className="quiet-button"
              type="button"
              onClick={() => {
                setPage(null);
                setFilters({});
              }}
            >
              Clear filters
            </button>
          )}
          {data && (
            <span className="table-count muted">
              {data.items.length} on this page
            </span>
          )}
        </div>
        <ResourceMessage
          result={result}
          empty={data?.items.length === 0 ? "No jobs match these filters." : ""}
        />
        {!!data?.items.length && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Status</th>
                  <th className="secondary-column" scope="col">
                    Priority
                  </th>
                  <th scope="col">Attempts</th>
                  <th className="date-column" scope="col">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <Link
                        className="record-link"
                        to={`/jobs/${job.id}`}
                        state={{ listUrl }}
                      >
                        {label(job.type)}
                      </Link>
                      <span className="muted record-id">
                        {job.id.slice(0, 8)}
                      </span>
                    </td>
                    <td>
                      <Status value={job.status} />
                    </td>
                    <td className="secondary-column">{label(job.priority)}</td>
                    <td className="tabular">
                      {job.attemptNumber} / {job.maxAttempts}
                    </td>
                    <td className="date-column muted tabular">
                      {showTime(job.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          cursors={cursors}
          next={data?.nextCursor}
          update={(next) => setPage({ key: filterKey, cursors: next })}
        />
      </section>
    </>
  );
}

export function NewJob() {
  const [type, setType] = useState("GENERATE_REPORT");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submission = useRef();
  const navigate = useNavigate();
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const runAt = form.get("runAt");
    setPending(true);
    setError("");
    try {
      const body = {
        type,
        payload: Object.fromEntries(
          payloadFields[type].map(([name]) => [name, form.get(name)]),
        ),
        priority: form.get("priority"),
        maxAttempts: Number(form.get("maxAttempts")),
        ...(runAt && { runAt: new Date(runAt).toISOString() }),
      };
      const contents = JSON.stringify(body);
      if (submission.current?.contents !== contents) {
        submission.current = { contents, key: crypto.randomUUID() };
      }
      const job = await api("/jobs", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": submission.current.key },
      });
      navigate(`/jobs/${job.id}`);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="page-title">
        <Link className="back-link" to="/jobs">
          <span aria-hidden="true">← </span>Back to jobs
        </Link>
        <h1>New job</h1>
      </div>
      <form className="panel form wide-form" onSubmit={submit}>
        <label>
          Job type{" "}
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {Object.keys(payloadFields).map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        {payloadFields[type].map(([name, title]) => (
          <label key={name}>
            {title}
            <input
              name={name}
              required
              maxLength={64}
              pattern={"[A-Za-z0-9_\\-]{1,64}"}
            />
          </label>
        ))}
        <div className="form-pair">
          <label>
            Priority{" "}
            <select name="priority" defaultValue="NORMAL">
              {["LOW", "NORMAL", "HIGH"].map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Maximum attempts{" "}
            <input
              name="maxAttempts"
              type="number"
              min="1"
              max="5"
              step="1"
              defaultValue="3"
              required
            />
          </label>
        </div>
        <label>
          Run at (local time) <input name="runAt" type="datetime-local" />
          <span className="muted">
            Leave blank to run as soon as a worker is available.
          </span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit job"}
        </button>
      </form>
    </>
  );
}

function Activity({ id, kind, revision }) {
  const [cursors, setCursors] = useState([""]);
  const query = new URLSearchParams(
    cursors.at(-1) ? { cursor: cursors.at(-1) } : {},
  );
  const result = useApi(`/jobs/${id}/${kind}?${query}`, revision);
  return (
    <section className="panel history-panel">
      <h2>{kind === "events" ? "Timeline" : "Attempts"}</h2>
      <ResourceMessage
        result={result}
        empty={result.data?.items.length === 0 ? "No activity yet." : ""}
      />
      <ul className="activity">
        {result.data?.items.map((item) => (
          <li key={item.id} data-outcome={item.outcome}>
            <strong>
              {item.eventType
                ? label(item.eventType.replace(/^JOB_/, ""))
                : `Attempt ${item.attemptNo} · ${label(item.outcome)}`}
            </strong>
            <span className="muted">
              {showTime(item.occurredAt ?? item.startedAt)}
            </span>
            {(item.errorCode ?? item.details?.errorCode) && (
              <span className="activity-error">
                {label(item.errorCode ?? item.details.errorCode)}
              </span>
            )}
            {item.details?.reason && <span>{item.details.reason}</span>}
          </li>
        ))}
      </ul>
      <Pager
        cursors={cursors}
        next={result.data?.nextCursor}
        update={setCursors}
      />
    </section>
  );
}

export function JobDetail({ revision }) {
  const { id } = useParams();
  const { state } = useLocation();
  const [local, setLocal] = useState(0);
  const [pending, setPending] = useState(false);
  const cancelDialog = useRef(null);
  const [error, setError] = useState("");
  const refresh = `${revision}:${local}`;
  const result = useApi(`/jobs/${id}`, refresh);
  const job = result.data;
  const canCancel = ["PENDING", "QUEUED", "RETRY_WAIT"].includes(job?.status);
  async function cancel() {
    setPending(true);
    setError("");
    try {
      await api(`/jobs/${id}/cancel`, { method: "POST" });
      cancelDialog.current?.close();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLocal((value) => value + 1);
      setPending(false);
    }
  }
  return (
    <>
      <div className="page-title">
        <Link className="back-link" to={state?.listUrl ?? "/jobs"}>
          <span aria-hidden="true">← </span>Back to jobs
        </Link>
        <div className="heading detail-heading">
          <h1>{job ? label(job.type) : "Job detail"}</h1>
          {job && <Status value={job.status} />}
        </div>
      </div>
      <ResourceMessage result={result} />
      {job && (
        <>
          <section className="panel detail-panel">
            <div className="row">
              <h2>Job details</h2>
              <span className="muted record-id breakable">{job.id}</span>
            </div>
            <dl className="details">
              <div>
                <dt>Priority</dt>
                <dd>{label(job.priority)}</dd>
              </div>
              <div>
                <dt>Attempts</dt>
                <dd>
                  {job.attemptNumber} / {job.maxAttempts}
                </dd>
              </div>
              <div>
                <dt>Run at</dt>
                <dd>{showTime(job.runAt)}</dd>
              </div>
              <div>
                <dt>Next run</dt>
                <dd>{showTime(job.nextRunAt)}</dd>
              </div>
              <div>
                <dt>Finished</dt>
                <dd>{showTime(job.finishedAt)}</dd>
              </div>
            </dl>
            <div className="row detail-actions">
              {job.replayOfId && (
                <Link to={`/jobs/${job.replayOfId}`}>Original job</Link>
              )}
              {canCancel && (
                <>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => {
                      setError("");
                      cancelDialog.current.showModal();
                    }}
                  >
                    Cancel job
                  </button>
                  <dialog
                    ref={cancelDialog}
                    aria-labelledby="cancel-title"
                    onCancel={(event) => {
                      if (pending) event.preventDefault();
                    }}
                  >
                    <div className="form">
                      <h2 id="cancel-title">Cancel this job?</h2>
                      <p>
                        Cancellation is available until the next attempt starts.
                      </p>
                      {error && (
                        <p className="error" role="alert">
                          {error}
                        </p>
                      )}
                      <div className="row dialog-actions">
                        <button
                          type="button"
                          autoFocus
                          disabled={pending}
                          onClick={() => cancelDialog.current.close()}
                        >
                          Keep job
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          disabled={pending}
                          onClick={cancel}
                        >
                          {pending ? "Cancelling…" : "Confirm cancel"}
                        </button>
                      </div>
                    </div>
                  </dialog>
                </>
              )}
            </div>
            {!canCancel && error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
          <div className="split">
            <Activity
              key={`${id}-attempts`}
              id={id}
              kind="attempts"
              revision={refresh}
            />
            <Activity
              key={`${id}-events`}
              id={id}
              kind="events"
              revision={refresh}
            />
          </div>
        </>
      )}
    </>
  );
}
