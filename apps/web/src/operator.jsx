import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, label, showTime, useApi } from "./api.js";
import { Pager, ResourceMessage } from "./jobs.jsx";

const countFormat = new Intl.NumberFormat();
const formatCount = (value) => countFormat.format(value);
const statusColors = {
  PENDING: "#b1bbb3",
  QUEUED: "#4b799b",
  RUNNING: "#537d6a",
  RETRY_WAIT: "#bb813d",
  COMPLETED: "#297451",
  DEAD: "#a75549",
  CANCELLED: "#7c847e",
};

export function Overview({ revision }) {
  const [refresh, setRefresh] = useState(0);
  const result = useApi("/admin/overview", `${revision}:${refresh}`);
  const data = result.data;
  const jobs = data
    ? Object.entries(data.counts).map(([status, count]) => ({
        state: status,
        status: label(status),
        count,
      }))
    : [];
  return (
    <>
      <div className="heading">
        <h1>Overview</h1>
        <div className="row overview-actions">
          {data && <span className="muted">Updated {showTime(data.at)}</span>}
          <button onClick={() => setRefresh((value) => value + 1)}>
            Refresh
          </button>
        </div>
      </div>
      <ResourceMessage result={result} />
      {data && (
        <>
          <dl className="metric-strip" aria-label="Queue summary">
            {[
              ["Queued", data.counts.QUEUED],
              ["Running", data.counts.RUNNING],
              ["Completed, last minute", data.completedLastMinute],
              ["Active workers", data.activeWorkers ?? "Unknown"],
            ].map(([title, count]) => (
              <div key={title}>
                <dt>{title}</dt>
                <dd className="tabular">
                  {typeof count === "number" ? formatCount(count) : count}
                </dd>
              </div>
            ))}
          </dl>
          <div className="overview-grid">
            <section className="panel distribution">
              <div className="heading compact">
                <h2>Jobs by status</h2>
                <Link to="/jobs">
                  View jobs <span aria-hidden="true">→</span>
                </Link>
              </div>
              <div className="chart" aria-hidden="true">
                <ResponsiveContainer width="100%" height={276}>
                  <BarChart
                    data={jobs}
                    layout="vertical"
                    margin={{ left: 0, right: 14 }}
                  >
                    <CartesianGrid
                      stroke="#e4e9e4"
                      strokeDasharray="3 3"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      stroke="#55635a"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                    />
                    <YAxis
                      dataKey="status"
                      type="category"
                      width={80}
                      stroke="#34453b"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "#edf3ef" }}
                      contentStyle={{
                        background: "#fff",
                        borderColor: "#d9e2da",
                        color: "#14251e",
                      }}
                    />
                    <Bar
                      dataKey="count"
                      name="Jobs"
                      radius={[0, 3, 3, 0]}
                      barSize={14}
                      isAnimationActive={false}
                    >
                      {jobs.map(({ state }) => (
                        <Cell key={state} fill={statusColors[state]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <dl className="sr-only">
                {jobs.map(({ status, count }) => (
                  <div key={status}>
                    <dt>{status}</dt>
                    <dd>{formatCount(count)}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="panel attention">
              <h2>Needs attention</h2>
              <Link to="/dead-letters">
                <span>
                  <strong>Dead letters</strong>
                  <small>Jobs that ended in failure</small>
                </span>
                <strong className="tabular attention-failed">
                  {formatCount(data.counts.DEAD)}
                </strong>
              </Link>
              <Link to="/jobs?status=RETRY_WAIT">
                <span>
                  <strong>Waiting to retry</strong>
                  <small>Jobs scheduled for another attempt</small>
                </span>
                <strong className="tabular attention-retry">
                  {formatCount(data.counts.RETRY_WAIT)}
                </strong>
              </Link>
            </section>
          </div>
        </>
      )}
    </>
  );
}

export function DeadLetters({ revision }) {
  const [cursors, setCursors] = useState([""]);
  const [selected, setSelected] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef(null);
  const navigate = useNavigate();
  const query = new URLSearchParams(
    cursors.at(-1) ? { cursor: cursors.at(-1) } : {},
  );
  const result = useApi(`/admin/dlq?${query}`, revision);
  useEffect(() => {
    if (selected && !dialog.current.open) dialog.current.showModal();
  }, [selected]);
  async function replay(event) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const job = await api(`/admin/dlq/${selected.id}/replay`, {
        method: "POST",
        body: Object.fromEntries(new FormData(event.currentTarget)),
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
      <h1>Dead letters</h1>
      <section className="panel table-panel" aria-label="Dead-letter list">
        <ResourceMessage
          result={result}
          empty={result.data?.items.length === 0 ? "No dead letters." : ""}
        />
        {!!result.data?.items.length && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Last error</th>
                  <th className="date-column" scope="col">
                    Recorded
                  </th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <Link className="record-id" to={`/jobs/${entry.jobId}`}>
                        {entry.jobId.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{label(entry.lastErrorCode)}</td>
                    <td className="date-column muted tabular">
                      {showTime(entry.createdAt)}
                    </td>
                    <td>
                      {entry.replayJobId ? (
                        <Link to={`/jobs/${entry.replayJobId}`}>
                          View replay
                        </Link>
                      ) : (
                        <button
                          onClick={() => {
                            setError("");
                            setSelected(entry);
                          }}
                        >
                          Replay
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          cursors={cursors}
          next={result.data?.nextCursor}
          update={setCursors}
        />
      </section>
      {selected && (
        <dialog
          ref={dialog}
          aria-labelledby="replay-title"
          onClose={() => setSelected(null)}
          onCancel={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <form className="form" onSubmit={replay}>
            <h2 id="replay-title">Replay job</h2>
            <p>Create a new run for job {selected.jobId.slice(0, 8)}.</p>
            <label>
              Reason{" "}
              <textarea
                name="reason"
                autoFocus
                required
                minLength={1}
                maxLength={200}
                rows={3}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="row dialog-actions">
              <button
                type="button"
                disabled={pending}
                onClick={() => dialog.current.close()}
              >
                Cancel
              </button>
              <button className="primary" disabled={pending}>
                {pending ? "Replaying…" : "Confirm replay"}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
