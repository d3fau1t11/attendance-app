import React, { useEffect, useState } from "react";
import { useSearch } from "wouter";
import {
  Clock,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Header } from "../components/Header";
import { apiRequest } from "../lib/api";

interface AttendanceSession {
  id: string;
  status: "checked_in" | "pending_exit" | "checked_out" | "needs_review";
  checkInAt: string;
  checkOutAt: string | null;
  checkoutReason: string | null;
  durationMinutes: number | null;
  isLate: boolean;
  lateByMinutes: number | null;
  needsReview: boolean;
  reviewNote: string | null;
  flags: string[];
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  employeeCode: string;
  jobTitle: string | null;
  workplaceId: string;
  workplaceName: string;
}

export function Attendance() {
  const searchParams = new URLSearchParams(useSearch());
  const needsReviewQuery = searchParams.get("needsReview") === "true";

  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(
    needsReviewQuery ? "needs_review" : "all"
  );

  // Selected session for admin override modal
  const [selectedSession, setSelectedSession] = useState<AttendanceSession | null>(null);
  const [overrideAction, setOverrideAction] = useState<"approve" | "force_checkout">("approve");
  const [overrideNote, setOverrideNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchSessions = async () => {
    setLoading(true);
    try {
      let url = "/admin/attendance?limit=100";
      if (statusFilter === "needs_review") {
        url += "&needsReview=true";
      } else if (statusFilter !== "all") {
        url += `&status=${statusFilter}`;
      }
      const res = await apiRequest<{ sessions: AttendanceSession[] }>(url);
      setSessions(res.sessions || []);
    } catch (err) {
      console.error("Failed to load attendance sessions", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [statusFilter]);

  const handleOverride = async () => {
    if (!selectedSession) return;
    setSubmitting(true);
    try {
      await apiRequest(`/admin/attendance/${selectedSession.id}/override`, {
        method: "POST",
        body: JSON.stringify({
          action: overrideAction,
          note: overrideNote,
        }),
      });
      setSelectedSession(null);
      setOverrideNote("");
      fetchSessions();
    } catch (err: any) {
      alert(err.message || "Failed to perform admin override.");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredSessions = sessions.filter((s) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      s.employeeName.toLowerCase().includes(term) ||
      s.employeeCode.toLowerCase().includes(term) ||
      s.workplaceName.toLowerCase().includes(term)
    );
  });

  return (
    <div className="flex-1 min-h-screen bg-slate-950 pb-12">
      <Header
        title="Attendance Ledger"
        subtitle="Auditable attendance logs, geofence sessions, and override queue"
        onRefresh={fetchSessions}
        isRefreshing={loading}
      />

      <main className="px-8 mt-8 space-y-6 max-w-7xl mx-auto">
        {/* Filter & Controls Bar */}
        <div className="glass-card p-4 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Search Box */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee, code or workplace…"
              className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
            />
          </div>

          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto w-full md:w-auto">
            {[
              { id: "all", label: "All Sessions" },
              { id: "checked_in", label: "Checked In" },
              { id: "pending_exit", label: "Pending Grace Exit" },
              { id: "needs_review", label: "Needs Review Queue" },
              { id: "checked_out", label: "Closed Sessions" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  statusFilter === tab.id
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sessions Table */}
        <div className="glass-card rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-900/60 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-4 px-6">Employee</th>
                  <th className="py-4 px-6">Workplace</th>
                  <th className="py-4 px-6">Check In</th>
                  <th className="py-4 px-6">Check Out</th>
                  <th className="py-4 px-6">Duration</th>
                  <th className="py-4 px-6">Flags / Reason</th>
                  <th className="py-4 px-6">Status</th>
                  <th className="py-4 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500">
                      Loading attendance records…
                    </td>
                  </tr>
                ) : filteredSessions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500">
                      No matching attendance sessions found.
                    </td>
                  </tr>
                ) : (
                  filteredSessions.map((session) => (
                    <tr
                      key={session.id}
                      className="hover:bg-slate-900/40 transition-colors"
                    >
                      {/* Employee Info */}
                      <td className="py-4 px-6">
                        <div className="font-semibold text-white">
                          {session.employeeName}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                            {session.employeeCode}
                          </span>
                          {session.isLate && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/40">
                              LATE {session.lateByMinutes ? `(${session.lateByMinutes}m)` : ""}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Workplace */}
                      <td className="py-4 px-6 font-medium text-slate-300">
                        {session.workplaceName}
                      </td>

                      {/* Check In */}
                      <td className="py-4 px-6 font-mono text-slate-300">
                        {new Date(session.checkInAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>

                      {/* Check Out */}
                      <td className="py-4 px-6 font-mono text-slate-400">
                        {session.checkOutAt
                          ? new Date(session.checkOutAt).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>

                      {/* Duration */}
                      <td className="py-4 px-6 font-mono text-slate-300">
                        {session.durationMinutes
                          ? `${Math.floor(session.durationMinutes / 60)}h ${
                              session.durationMinutes % 60
                            }m`
                          : "Active"}
                      </td>

                      {/* Flags & Reason */}
                      <td className="py-4 px-6">
                        {session.flags && session.flags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {session.flags.map((flag, idx) => (
                              <span
                                key={idx}
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-rose-950/50 text-rose-300 border border-rose-800/30"
                              >
                                {flag}
                              </span>
                            ))}
                          </div>
                        ) : session.checkoutReason ? (
                          <span className="text-[11px] text-slate-400 capitalize">
                            {session.checkoutReason.replace(/_/g, " ")}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-4 px-6">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                            session.status === "checked_in"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : session.status === "pending_exit"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : session.needsReview
                              ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              session.status === "checked_in"
                                ? "bg-emerald-400 animate-pulse"
                                : session.status === "pending_exit"
                                ? "bg-amber-400 animate-pulse"
                                : "bg-slate-400"
                            }`}
                          />
                          <span className="capitalize">
                            {session.needsReview
                              ? "Needs Review"
                              : session.status.replace("_", " ")}
                          </span>
                        </span>
                      </td>

                      {/* Action */}
                      <td className="py-4 px-6 text-right">
                        <button
                          onClick={() => setSelectedSession(session)}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-indigo-700/50 text-slate-300 hover:text-white font-medium text-xs transition-all cursor-pointer"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Override Modal */}
      {selectedSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="glass-card max-w-md w-full rounded-2xl p-6 border border-slate-800 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Admin Session Override</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedSession.employeeName} ({selectedSession.employeeCode})
                </p>
              </div>
              <button
                onClick={() => setSelectedSession(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Workplace:</span>
                  <span className="font-semibold text-white">{selectedSession.workplaceName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Check In Time:</span>
                  <span className="font-mono text-slate-300">
                    {new Date(selectedSession.checkInAt).toLocaleString()}
                  </span>
                </div>
                {selectedSession.flags && selectedSession.flags.length > 0 && (
                  <div className="pt-2 border-t border-slate-800">
                    <span className="text-rose-400 font-semibold block mb-1">Detected Anomaly Flags:</span>
                    <div className="flex flex-wrap gap-1">
                      {selectedSession.flags.map((f, i) => (
                        <span key={i} className="px-1.5 py-0.5 bg-rose-950 text-rose-300 rounded font-mono">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Override Decision
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setOverrideAction("approve")}
                    className={`p-3 rounded-xl border font-semibold text-xs transition-all cursor-pointer ${
                      overrideAction === "approve"
                        ? "bg-emerald-950/60 border-emerald-500 text-emerald-300"
                        : "bg-slate-900 border-slate-800 text-slate-400"
                    }`}
                  >
                    Approve / Clear Flag
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverrideAction("force_checkout")}
                    className={`p-3 rounded-xl border font-semibold text-xs transition-all cursor-pointer ${
                      overrideAction === "force_checkout"
                        ? "bg-rose-950/60 border-rose-500 text-rose-300"
                        : "bg-slate-900 border-slate-800 text-slate-400"
                    }`}
                  >
                    Force Close Session
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Audit Notes / Reason
                </label>
                <textarea
                  rows={3}
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                  placeholder="Provide justification for manual override…"
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setSelectedSession(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleOverride}
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30"
              >
                {submitting ? "Applying…" : "Confirm Override"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
