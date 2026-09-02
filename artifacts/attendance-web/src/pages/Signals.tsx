import React, { useEffect, useState } from "react";
import { ShieldAlert, AlertTriangle, Smartphone, MapPinOff, RefreshCw } from "lucide-react";
import { Header } from "../components/Header";
import { apiRequest } from "../lib/api";

interface DeviceSignal {
  id: string;
  signalType: string;
  detail: string | null;
  occurredAt: string;
  employeeName: string;
  employeeCode: string;
}

export function Signals() {
  const [signals, setSignals] = useState<DeviceSignal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSignals = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ signals: DeviceSignal[] }>("/admin/signals");
      setSignals(res.signals || []);
    } catch (err) {
      console.error("Failed to load device signals", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSignals();
  }, []);

  const getSignalBadge = (type: string) => {
    if (type.includes("mock") || type.includes("impossible")) {
      return "bg-rose-950/60 text-rose-300 border-rose-800/40";
    }
    if (type.includes("gps") || type.includes("location")) {
      return "bg-amber-950/60 text-amber-300 border-amber-800/40";
    }
    return "bg-slate-800 text-slate-300 border-slate-700";
  };

  return (
    <div className="flex-1 min-h-screen bg-slate-950 pb-12">
      <Header
        title="Anomaly & Device Signals"
        subtitle="Real-time security telemetry, mock location detection, and hardware dropouts"
        onRefresh={fetchSignals}
        isRefreshing={loading}
      />

      <main className="px-8 mt-8 space-y-6 max-w-7xl mx-auto">
        <div className="glass-card rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
          <div className="p-6 border-b border-slate-800/80 flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Audit Feed of Device Interruption Events
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-900/60 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-4 px-6">Timestamp</th>
                  <th className="py-4 px-6">Employee</th>
                  <th className="py-4 px-6">Signal Category</th>
                  <th className="py-4 px-6">Technical Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-500">
                      Loading security signals…
                    </td>
                  </tr>
                ) : signals.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-500">
                      No security or device anomaly signals recorded.
                    </td>
                  </tr>
                ) : (
                  signals.map((sig) => (
                    <tr key={sig.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="py-4 px-6 font-mono text-slate-300">
                        {new Date(sig.occurredAt).toLocaleString()}
                      </td>

                      <td className="py-4 px-6">
                        <div className="font-semibold text-white">{sig.employeeName}</div>
                        <div className="text-[10px] font-mono text-slate-400">{sig.employeeCode}</div>
                      </td>

                      <td className="py-4 px-6">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold font-mono border uppercase tracking-wider ${getSignalBadge(
                            sig.signalType
                          )}`}
                        >
                          {sig.signalType.replace(/_/g, " ")}
                        </span>
                      </td>

                      <td className="py-4 px-6 text-slate-400">
                        {sig.detail || "No additional detail reported by OS"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
