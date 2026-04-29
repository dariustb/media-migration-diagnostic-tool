import { useState, useEffect, useRef, useCallback } from "react";

interface FormValues {
  local_root: string;
  remote_host: string;
  remote_port: string;
  remote_user: string;
  remote_password: string;
  remote_root: string;
}

interface JobResponse {
  job_id: string;
  status: string;
  stage: number;
  stage_name: string;
  stage_progress: Record<string, number>;
  error: string | null;
  results: Record<string, unknown>;
}

interface Summary {
  total_source_files: number;
  total_dest_files: number;
  source_unique: number;
  dest_unique: number;
  local_duplicate_names: number;
  remote_duplicate_names: number;
  matched_count: number;
  source_only_count: number;
  dest_only_count: number;
  checksum_ok_count: number;
  checksum_bad_count: number;
  match_rate: number;
  integrity_rate: number;
  grade: string;
}

interface BadEntry {
  filename: string;
  local_path: string;
  remote_path: string;
  local_checksum: string;
  remote_checksum: string;
}

const STAGES = 5;

const GRADE_COLORS: Record<string, string> = {
  A: "text-green-600 bg-green-50 border-green-200",
  B: "text-lime-600 bg-lime-50 border-lime-200",
  C: "text-yellow-600 bg-yellow-50 border-yellow-200",
  D: "text-orange-600 bg-orange-50 border-orange-200",
  F: "text-red-600 bg-red-50 border-red-200",
};

const DEFAULT_FORM: FormValues = {
  local_root: "",
  remote_host: "",
  remote_port: "22",
  remote_user: "",
  remote_password: "",
  remote_root: "",
};

function Field({
  label,
  name,
  type = "text",
  value,
  placeholder,
  onChange,
}: {
  label: string;
  name: keyof FormValues;
  type?: string;
  value: string;
  placeholder?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <input
        type={type}
        name={name}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <div className="text-2xl font-bold text-gray-800">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

function App() {
  const [form, setForm] = useState<FormValues>(DEFAULT_FORM);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/scan/${jobId}`);
        const data: JobResponse = await res.json();
        setJob(data);
        if (data.status === "complete" || data.status === "error") {
          stopPolling();
        }
      } catch {
        // network hiccup — keep polling
      }
    };
    poll();
    pollRef.current = setInterval(poll, 1000);
    return stopPolling;
  }, [jobId, stopPolling]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    setJob(null);
    setJobId(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          remote_port: parseInt(form.remote_port, 10) || 22,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error ?? "Unknown error");
        return;
      }
      setJobId(data.job_id);
    } catch (err) {
      setFormError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    stopPolling();
    setJobId(null);
    setJob(null);
    setFormError(null);
  };

  const isRunning = job?.status === "running" || job?.status === "pending";
  const isDone = job?.status === "complete";
  const isError = job?.status === "error";

  const summary = isDone
    ? (job!.results.summary as Summary | undefined)
    : undefined;
  const checksumOk = isDone
    ? ((job!.results.checksum_ok as BadEntry[]) ?? [])
    : [];
  const checksumBad = isDone
    ? ((job!.results.checksum_bad as BadEntry[]) ?? [])
    : [];
  const allMatched = [...checksumOk.map((f) => ({ ...f, ok: true })), ...checksumBad.map((f) => ({ ...f, ok: false }))].sort((a, b) =>
    a.filename.localeCompare(b.filename)
  );
  const sourceOnly = isDone
    ? ((job!.results.source_only as { name: string; rel_dir: string }[]) ?? [])
    : [];
  const destOnly = isDone
    ? ((job!.results.dest_only as { name: string; rel_dir: string }[]) ?? [])
    : [];

  return (
    <div className="min-h-screen bg-gray-100 flex items-start justify-center py-12 px-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-xl">
        <h1 className="text-2xl font-bold text-gray-800 mb-1">
          Media Diagnostic
        </h1>
        <p className="text-gray-500 text-sm mb-6">
          Compare local and remote media libraries during migration.
        </p>

        {/* ── Form ──────────────────────────────────────────── */}
        {!jobId && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="border border-gray-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Local (source)
              </p>
              <Field
                label="Local root path"
                name="local_root"
                value={form.local_root}
                placeholder="/mnt/media/library"
                onChange={handleChange}
              />
            </div>

            <div className="border border-gray-200 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Remote (destination)
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field
                    label="Host"
                    name="remote_host"
                    value={form.remote_host}
                    placeholder="192.168.1.10"
                    onChange={handleChange}
                  />
                </div>
                <Field
                  label="Port"
                  name="remote_port"
                  type="number"
                  value={form.remote_port}
                  placeholder="22"
                  onChange={handleChange}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Username"
                  name="remote_user"
                  value={form.remote_user}
                  placeholder="pi"
                  onChange={handleChange}
                />
                <Field
                  label="Password"
                  name="remote_password"
                  type="password"
                  value={form.remote_password}
                  onChange={handleChange}
                />
              </div>
              <Field
                label="Remote root path"
                name="remote_root"
                value={form.remote_root}
                placeholder="/home/pi/media"
                onChange={handleChange}
              />
            </div>

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-xl transition-colors"
            >
              {submitting ? "Starting scan…" : "Start scan"}
            </button>
          </form>
        )}

        {/* ── Progress ──────────────────────────────────────── */}
        {jobId && (isRunning || (!isDone && !isError)) && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
              <span className="text-gray-700 font-medium">
                {job?.stage_name || "Starting…"}
              </span>
            </div>

            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${Math.round(((job?.stage ?? 0) / STAGES) * 100)}%`,
                }}
              />
            </div>
            <p className="text-xs text-gray-400 text-right">
              Stage {job?.stage ?? 0} of {STAGES}
              {job?.stage_progress?.total
                ? ` — ${job.stage_progress.done ?? 0} / ${job.stage_progress.total} files`
                : ""}
            </p>

            <button
              onClick={handleReset}
              className="text-sm text-gray-400 hover:text-gray-600 underline"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ── Error ─────────────────────────────────────────── */}
        {isError && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="font-medium text-red-700 mb-1">Scan failed</p>
              <p className="text-sm text-red-600 font-mono break-all">
                {job?.error}
              </p>
            </div>
            <button
              onClick={handleReset}
              className="w-full py-2 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* ── Results ───────────────────────────────────────── */}
        {isDone && summary && (
          <div>
            {/* Grade */}
            <div className="flex items-center gap-4 mb-6">
              <div
                className={`text-5xl font-extrabold border-2 rounded-2xl w-20 h-20 flex items-center justify-center ${GRADE_COLORS[summary.grade] ?? ""}`}
              >
                {summary.grade}
              </div>
              <div>
                <p className="text-sm text-gray-500">Migration health</p>
                <p className="text-lg font-semibold text-gray-800">
                  {summary.match_rate}% matched &middot;{" "}
                  {summary.integrity_rate}% intact
                </p>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-3">
              <StatBox label="Source files" value={summary.total_source_files} />
              <StatBox label="Dest files" value={summary.total_dest_files} />
              <StatBox label="Matched" value={summary.matched_count} />
              <StatBox
                label="Checksum OK"
                value={summary.checksum_ok_count}
              />
              <StatBox
                label="Checksum bad"
                value={summary.checksum_bad_count}
              />
              <StatBox
                label="Source only"
                value={summary.source_only_count}
              />
            </div>

            {/* Duplicates note */}
            {(summary.local_duplicate_names > 0 ||
              summary.remote_duplicate_names > 0) && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-4">
                Skipped from matching: {summary.local_duplicate_names} source
                filename(s) and {summary.remote_duplicate_names} dest
                filename(s) that appear more than once.
              </p>
            )}

            {/* Matched files */}
            {allMatched.length > 0 && (
              <Section title={`Matched files (${allMatched.length})`}>
                <div className="flex gap-4 mb-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z" clipRule="evenodd" />
                    </svg>
                    Checksums match
                  </span>
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 text-yellow-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-3a1 1 0 00-1 1v.5a1 1 0 002 0V11a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    Checksums differ
                  </span>
                </div>
                <div className="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100 max-h-72 overflow-y-auto">
                  {allMatched.map((f) => (
                    <div key={f.filename} className="flex items-center gap-3 px-3 py-2">
                      {f.ok ? (
                        <svg className="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-yellow-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-3a1 1 0 00-1 1v.5a1 1 0 002 0V11a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      )}
                      <span className="text-sm font-mono text-gray-700 truncate">{f.filename}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Source only */}
            {sourceOnly.length > 0 && (
              <Section title={`Source only — not found in destination (${sourceOnly.length})`}>
                <div className="rounded-xl border border-gray-200 overflow-hidden max-h-48 overflow-y-auto divide-y divide-gray-100">
                  {sourceOnly.map((f) => (
                    <div key={f.name} className="flex items-baseline gap-2 px-3 py-1.5">
                      <span className="text-sm font-mono text-gray-800">{f.name}</span>
                      {f.rel_dir && (
                        <span className="text-xs font-mono text-gray-400 truncate">{f.rel_dir}</span>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Dest only */}
            {destOnly.length > 0 && (
              <Section title={`Destination only — not found in source (${destOnly.length})`}>
                <div className="rounded-xl border border-gray-200 overflow-hidden max-h-48 overflow-y-auto divide-y divide-gray-100">
                  {destOnly.map((f) => (
                    <div key={f.name} className="flex items-baseline gap-2 px-3 py-1.5">
                      <span className="text-sm font-mono text-gray-800">{f.name}</span>
                      {f.rel_dir && (
                        <span className="text-xs font-mono text-gray-400 truncate">{f.rel_dir}</span>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <button
              onClick={handleReset}
              className="mt-6 w-full py-2 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              New scan
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
