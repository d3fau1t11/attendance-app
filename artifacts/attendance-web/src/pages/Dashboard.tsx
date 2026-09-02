import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Users,
  MapPin,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowUpRight,
  Activity,
  ShieldAlert,
  ChevronRight,
} from "lucide-react";
import { Header } from "../components/Header";
import { StatsCard } from "../components/StatsCard";
import { apiRequest } from "../lib/api";

interface AdminStats {
  totalEmployees: number;
  activeWorkplaces: number;
  checkedIn: number;
  pendingExit: number;
  needsReview: number;
  lateToday: number;
  recentActivity: Array<{
    id: string;
    status: string;
    employeeName: string;
    employeeCode: string;
    workplaceName: string;
    checkInAt: string;
    checkOutAt: string | null;
    isLate: boolean;
    needsReview: boolean;
    flags: string[];
  }>;
}

export function Dashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const data = await apiRequest<AdminStats>("/admin/stats");
      setStats(data);
    } catch (err) {
      console.error("Failed to load admin stats", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return (
    <div className="flex-1 min-h-screen bg-slate-950 pb-12">
      <Header
        title="Operations Dashboard"
        subtitle="Real-time multi-tenant presence and geofence monitoring"
        onRefresh={fetchStats}
        isRefreshing={loading}
      />

      <main className="px-8 mt-8 space-y-8 max-w-7xl mx-auto">
        {/* Needs Review Alert Banner */}
        {stats && stats.needsReview > 0 && (
          <div className="glass-card p-6 rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 to-slate-900 flex items-center justify-between shadow-xl">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
                <AlertTriangle className="w-6 h-6 animate-bounce" />
              </div>
              <div>
                <h3 className="text-base font-bold text-amber-300">
                  {stats.needsReview} Session{stats.needsReview > 1 ? "s" : ""} Require Human Review
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Device signals or auto-sweeper detected potential attendance anomalies or forced exits.
                </p>
              </div>
            </div>
            <Link
              href="/attendance?needsReview=true"
              className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 flex items-center gap-1.5 transition-all shrink-0 cursor-pointer"
            >
              <span>Review Queue</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {/* Top Metric Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <StatsCard
            title="Total Active Staff"
            value={stats?.totalEmployees ?? 0}
            subtitle="Registered employees"
            icon={Users}
            colorTheme="indigo"
          />
          <StatsCard
            title="Currently Checked In"
            value={stats?.checkedIn ?? 0}
            subtitle="Live inside geofence"
            icon={CheckCircle2}
            colorTheme="emerald"
            badge="Live"
          />
          <StatsCard
            title="Pending Grace Exit"
            value={stats?.pendingExit ?? 0}
            subtitle="Awaiting return deadline"
            icon={Clock}
            colorTheme="cyan"
          />
          <StatsCard
            title="Needs Review"
            value={stats?.needsReview ?? 0}
            subtitle="Anomalies flagged"
            icon={AlertTriangle}
            colorTheme="amber"
            badge={stats?.needsReview ? "Action Req." : undefined}
          />
        </div>

        {/* Two-column layout: Recent Activity Feed & Workplaces Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent Activity Stream */}
          <div className="lg:col-span-2 glass-card rounded-2xl p-6 border border-slate-800">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-400" />
                <h2 className="text-lg font-bold text-white tracking-tight">
                  Recent Attendance Stream
                </h2>
              </div>
              <Link
                href="/attendance"
                className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
              >
                <span>View All Logs</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {loading ? (
              <div className="py-12 text-center text-slate-500 text-sm">
                Loading activity feed…
              </div>
            ) : !stats?.recentActivity || stats.recentActivity.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">
                No recent attendance activity recorded today.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {stats.recentActivity.map((item) => (
                  <div
                    key={item.id}
                    className="py-4 flex items-center justify-between hover:bg-slate-900/40 px-3 rounded-xl transition-colors"
                  >
                    <div className="flex items-center gap-3.5">
                      <div
                        className={`w-3 h-3 rounded-full shrink-0 ${
                          item.status === "checked_in"
                            ? "bg-emerald-500 shadow-sm shadow-emerald-500/50"
                            : item.status === "pending_exit"
                            ? "bg-amber-500 animate-pulse"
                            : "bg-slate-600"
                        }`}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-white">
                            {item.employeeName}
                          </p>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                            {item.employeeCode}
                          </span>
                          {item.isLate && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/40">
                              LATE
                            </span>
                          )}
                          {item.needsReview && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/40">
                              REVIEW
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          At <span className="text-slate-300 font-medium">{item.workplaceName}</span>
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-xs font-mono text-slate-300">
                        {new Date(item.checkInAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="text-[10px] text-slate-500 capitalize">
                        {item.status.replace("_", " ")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Shortcuts & Live Workplace Status */}
          <div className="space-y-6">
            {/* Quick Actions Panel */}
            <div className="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
              <h3 className="text-base font-bold text-white tracking-tight">
                Quick Shortcuts
              </h3>

              <Link
                href="/workplaces"
                className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/80 hover:bg-indigo-950/40 border border-slate-800 hover:border-indigo-700/50 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 group-hover:scale-110 transition-transform">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">Workplaces & QR Kiosks</p>
                    <p className="text-[10px] text-slate-400">Launch live entrance codes</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-colors" />
              </Link>

              <Link
                href="/employees"
                className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/80 hover:bg-indigo-950/40 border border-slate-800 hover:border-indigo-700/50 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">Onboard Staff</p>
                    <p className="text-[10px] text-slate-400">Register employees & managers</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
              </Link>

              <Link
                href="/signals"
                className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/80 hover:bg-indigo-950/40 border border-slate-800 hover:border-indigo-700/50 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">Anomaly Logs</p>
                    <p className="text-[10px] text-slate-400">GPS & mock location signals</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-amber-400 transition-colors" />
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
