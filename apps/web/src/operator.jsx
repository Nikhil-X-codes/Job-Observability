import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, label, showTime, useApi } from "./api.js";
import { Pager, ResourceMessage } from "./jobs.jsx";

export function Overview({ revision }) {
  const [refresh, setRefresh] = useState(0);
  const result = useApi("/admin/overview", `${revision}:${refresh}`);
  const data = result.data;
  const jobs = data
    ? Object.entries(data.counts).map(([status, count]) => ({
        status: label(status),
        count,
      }))
    : [];
  return (
    <>
      <div className="heading">
        <h1>Overview</h1>
        <button onClick={() => setRefresh((value) => value + 1)}>
          Refresh
        </button>
      </div>
      <ResourceMessage result={result} />
      {data && (
        <>
          <div className="cards">
            {[
              ["Eligible jobs", data.counts.QUEUED],
              ["Running", data.counts.RUNNING],
              ["Completed, last minute", data.completedLastMinute],
              ["Active workers", data.activeWorkers ?? "Unknown"],
            ].map(([title, count]) => (
              <section className="panel stat" key={title}>
                <h2>{title}</h2>
                <strong>{count}</strong>
              </section>
            ))}
          </div>
          <section className="panel">
            <div className="heading compact">
              <h2>Jobs by status</h2>
              <span className="muted">Updated {showTime(data.at)}</span>
            </div>
            <div className="chart" aria-hidden="true">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={jobs}
                  layout="vertical"
                  margin={{ left: 16, right: 12 }}
                >
                  <CartesianGrid stroke="#24364b" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} stroke="#a8bdd2" />
                  <YAxis
                    dataKey="status"
                    type="category"
                    width={85}
                    stroke="#a8bdd2"
                  />
                  <Tooltip
                    cursor={{ fill: "#213449" }}
                    contentStyle={{
                      background: "#132338",
                      borderColor: "#36506c",
                      color: "#e7f3fc",
                    }}
                  />
                  <Bar
                    dataKey="count"
                    name="Jobs"
                    fill="#75d7ff"
                    radius={4}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <dl className="count-summary">
              {jobs.map(({ status, count }) => (
                <div key={status}>
                  <dt>{status}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
          </section>
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
  const navigate = useNavigate();
  const query = new URLSearchParams(
    cursors.at(-1) ? { cursor: cursors.at(-1) } : {},
  );
  const result = useApi(`/admin/dlq?${query}`, revision);
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
      <section className="panel">
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
                  <th scope="col">Recorded</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <Link to={`/jobs/${entry.jobId}`}>
                        {entry.jobId.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{label(entry.lastErrorCode)}</td>
                    <td>{showTime(entry.createdAt)}</td>
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
        <form className="panel form wide-form" onSubmit={replay}>
          <h2>Confirm replay</h2>
          <p>Create a new run for job {selected.jobId.slice(0, 8)}.</p>
          <label>
            Reason{" "}
            <textarea
              name="reason"
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
          <div className="row">
            <button className="primary" disabled={pending}>
              Confirm replay
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setSelected(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </>
  );
}
