import React, { useEffect, useState } from "react";
import { X, QrCode, ShieldCheck, RefreshCw, Radio } from "lucide-react";
import { apiRequest } from "../lib/api";

interface QrKioskModalProps {
  workplaceId: string;
  workplaceName: string;
  onClose: () => void;
}

interface QrTokenData {
  token: string;
  mode: "rotating" | "static";
  rotationSeconds: number;
  expiresInSeconds: number | null;
  workplaceName: string;
}

export function QrKioskModal({ workplaceId, workplaceName, onClose }: QrKioskModalProps) {
  const [data, setData] = useState<QrTokenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState<number>(30);

  const fetchToken = async () => {
    try {
      const res = await apiRequest<QrTokenData>(`/workplaces/${workplaceId}/qr-token`);
      setData(res);
      if (res.expiresInSeconds !== null) {
        setTimeLeft(res.expiresInSeconds);
      }
    } catch (err) {
      console.error("Failed to fetch QR token", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchToken();
    const interval = setInterval(fetchToken, (data?.rotationSeconds || 15) * 1000);
    return () => clearInterval(interval);
  }, [workplaceId]);

  useEffect(() => {
    if (data?.mode === "static") return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 1 ? prev - 1 : data?.rotationSeconds || 30));
    }, 1000);
    return () => clearInterval(timer);
  }, [data]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn select-none">
      <div className="glass-card max-w-lg w-full rounded-3xl p-8 border border-indigo-500/30 relative text-center shadow-2xl overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 p-2 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-3">
          <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
          <span>Live Entrance Kiosk</span>
        </div>

        <h2 className="text-2xl font-bold text-white tracking-tight">{workplaceName}</h2>
        <p className="text-xs text-slate-400 mt-1">Scan via Attendance Mobile App inside the geofence</p>

        {/* QR Code Container */}
        <div className="my-6 p-6 rounded-2xl bg-white/95 border-2 border-indigo-500/20 inline-block shadow-xl relative group">
          {loading ? (
            <div className="w-64 h-64 flex items-center justify-center text-slate-700">
              <RefreshCw className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          ) : data ? (
            <img
              src={`/api/workplaces/${workplaceId}/qr.svg?t=${encodeURIComponent(data.token)}`}
              alt="Workplace Attendance QR"
              className="w-64 h-64 object-contain mx-auto"
            />
          ) : (
            <div className="w-64 h-64 flex items-center justify-center text-rose-600 text-xs font-semibold">
              Failed to load QR Token
            </div>
          )}
        </div>

        {/* Rotation & Security Footer */}
        {data && (
          <div className="space-y-4">
            {data.mode === "rotating" ? (
              <div className="space-y-1.5 max-w-xs mx-auto">
                <div className="flex justify-between text-xs font-medium text-slate-400">
                  <span>Rotating Security Token</span>
                  <span className="text-indigo-400 font-bold font-mono">{timeLeft}s remaining</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-1000 ease-linear"
                    style={{
                      width: `${(timeLeft / (data.rotationSeconds || 30)) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 text-xs font-semibold">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Static Kiosk Token Active</span>
              </div>
            )}

            <p className="text-[11px] text-slate-500 font-mono">
              Workplace ID: {workplaceId}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
