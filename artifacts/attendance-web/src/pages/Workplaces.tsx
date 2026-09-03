import React, { useEffect, useState } from "react";
import {
  MapPin,
  Plus,
  QrCode,
  Radio,
  Settings,
  Shield,
  Clock,
  Compass,
  CheckCircle,
  Edit2,
  Locate,
} from "lucide-react";
import { Header } from "../components/Header";
import { QrKioskModal } from "../components/QrKioskModal";
import { WorkplaceMapPicker } from "../components/WorkplaceMapPicker";
import { apiRequest } from "../lib/api";

interface Workplace {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusM: number;
  exitBufferM: number;
  maxAccuracyM: number;
  exitGraceSeconds: number;
  heartbeatTimeoutSeconds: number;
  qrMode: "rotating" | "static";
  qrRotationSeconds: number;
  timezone: string;
  workStart: string;
  workEnd: string;
  isActive: boolean;
}

export function Workplaces() {
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);
  const [loading, setLoading] = useState(true);

  // Kiosk Modal state
  const [activeKiosk, setActiveKiosk] = useState<{ id: string; name: string } | null>(null);

  // Create Workplace Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState(9.0192);
  const [longitude, setLongitude] = useState(38.7468);
  const [radiusM, setRadiusM] = useState(150);
  const [qrMode, setQrMode] = useState<"rotating" | "static">("rotating");
  const [qrRotationSeconds, setQrRotationSeconds] = useState(30);
  const [workStart, setWorkStart] = useState("09:00:00");
  const [workEnd, setWorkEnd] = useState("17:00:00");
  const [submitting, setSubmitting] = useState(false);

  // Edit Workplace Modal state
  const [editingWorkplace, setEditingWorkplace] = useState<Workplace | null>(null);

  const fetchWorkplaces = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ workplaces: Workplace[] }>("/workplaces");
      setWorkplaces(res.workplaces || []);
    } catch (err) {
      console.error("Failed to load workplaces", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkplaces();
  }, []);

  const handleCreateWorkplace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !latitude || !longitude) return;

    setSubmitting(true);
    try {
      await apiRequest("/workplaces", {
        method: "POST",
        body: JSON.stringify({
          name,
          address,
          latitude: Number(latitude),
          longitude: Number(longitude),
          radiusM: Number(radiusM),
          qrMode,
          qrRotationSeconds: Number(qrRotationSeconds),
          workStart,
          workEnd,
        }),
      });
      setShowCreateModal(false);
      setName("");
      setAddress("");
      fetchWorkplaces();
    } catch (err: any) {
      alert(err.message || "Failed to create workplace.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditWorkplace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorkplace) return;

    setSubmitting(true);
    try {
      await apiRequest(`/workplaces/${editingWorkplace.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editingWorkplace.name,
          address: editingWorkplace.address,
          latitude: Number(editingWorkplace.latitude),
          longitude: Number(editingWorkplace.longitude),
          radiusM: Number(editingWorkplace.radiusM),
          qrMode: editingWorkplace.qrMode,
          qrRotationSeconds: Number(editingWorkplace.qrRotationSeconds),
          workStart: editingWorkplace.workStart,
          workEnd: editingWorkplace.workEnd,
          isActive: editingWorkplace.isActive,
        }),
      });
      setEditingWorkplace(null);
      fetchWorkplaces();
    } catch (err: any) {
      alert(err.message || "Failed to update workplace settings.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 min-h-screen bg-slate-950 pb-12">
      <Header
        title="Workplaces & QR Kiosks"
        subtitle="Manage geofenced site boundaries and live entrance QR display terminals"
        onRefresh={fetchWorkplaces}
        isRefreshing={loading}
      />

      <main className="px-8 mt-8 space-y-8 max-w-7xl mx-auto">
        {/* Top Control Bar */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Active Workplaces</h2>
            <p className="text-xs text-slate-400">
              Employees can only mark attendance inside authorized geofences
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Workplace</span>
          </button>
        </div>

        {/* Workplaces Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading ? (
            <div className="col-span-full py-12 text-center text-slate-500 text-sm">
              Loading workplaces…
            </div>
          ) : workplaces.length === 0 ? (
            <div className="col-span-full py-12 text-center text-slate-500 text-sm">
              No workplaces configured yet. Click "Add Workplace" to create one.
            </div>
          ) : (
            workplaces.map((wp) => (
              <div
                key={wp.id}
                className="glass-card rounded-2xl p-6 border border-slate-800 flex flex-col justify-between hover:border-indigo-500/40 transition-all group"
              >
                <div>
                  {/* Header Badge */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-105 transition-transform">
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          wp.qrMode === "rotating"
                            ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                            : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        }`}
                      >
                        {wp.qrMode} QR ({wp.qrRotationSeconds}s)
                      </span>
                    </div>
                  </div>

                  <h3 className="text-xl font-bold text-white tracking-tight">{wp.name}</h3>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                    {wp.address || "No physical address provided"}
                  </p>

                  {/* Geofence Parameters */}
                  <div className="mt-5 pt-4 border-t border-slate-800/80 space-y-2 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <Compass className="w-3.5 h-3.5 text-indigo-400" />
                        Coordinates:
                      </span>
                      <span className="font-mono text-slate-200">
                        {wp.latitude.toFixed(4)}, {wp.longitude.toFixed(4)}
                      </span>
                    </div>

                    <div className="flex justify-between text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <Radio className="w-3.5 h-3.5 text-emerald-400" />
                        Geofence Radius:
                      </span>
                      <span className="font-semibold text-emerald-400">
                        {wp.radiusM} meters
                      </span>
                    </div>

                    <div className="flex justify-between text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        Work Schedule:
                      </span>
                      <span className="font-mono text-slate-300">
                        {wp.workStart} – {wp.workEnd}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center gap-2">
                  <button
                    onClick={() => setActiveKiosk({ id: wp.id, name: wp.name })}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md shadow-indigo-600/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <QrCode className="w-4 h-4" />
                    <span>Launch Kiosk</span>
                  </button>

                  <button
                    onClick={() => setEditingWorkplace({ ...wp })}
                    className="py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit Map & Settings</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Live QR Kiosk Modal */}
      {activeKiosk && (
        <QrKioskModal
          workplaceId={activeKiosk.id}
          workplaceName={activeKiosk.name}
          onClose={() => setActiveKiosk(null)}
        />
      )}

      {/* Edit Workplace Modal with Interactive Map & Current Location GPS Picker */}
      {editingWorkplace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn overflow-y-auto">
          <div className="glass-card max-w-2xl w-full rounded-3xl p-6 border border-slate-800 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-xl font-bold text-white">Edit Workplace & Map Geofence</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Set location via interactive map pin or your current GPS location
                </p>
              </div>
              <button
                onClick={() => setEditingWorkplace(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditWorkplace} className="space-y-5 text-xs">
              {/* Interactive Map Picker & Current Location button */}
              <WorkplaceMapPicker
                latitude={editingWorkplace.latitude}
                longitude={editingWorkplace.longitude}
                radiusM={editingWorkplace.radiusM}
                onChangeLocation={(lat, lng, addr) => {
                  setEditingWorkplace({
                    ...editingWorkplace,
                    latitude: lat,
                    longitude: lng,
                    address: addr || editingWorkplace.address,
                  });
                }}
              />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Workplace Name</label>
                  <input
                    type="text"
                    value={editingWorkplace.name}
                    onChange={(e) =>
                      setEditingWorkplace({ ...editingWorkplace, name: e.target.value })
                    }
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Physical Address</label>
                  <input
                    type="text"
                    value={editingWorkplace.address || ""}
                    onChange={(e) =>
                      setEditingWorkplace({ ...editingWorkplace, address: e.target.value })
                    }
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={editingWorkplace.latitude}
                    onChange={(e) =>
                      setEditingWorkplace({
                        ...editingWorkplace,
                        latitude: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white font-mono focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={editingWorkplace.longitude}
                    onChange={(e) =>
                      setEditingWorkplace({
                        ...editingWorkplace,
                        longitude: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white font-mono focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Geofence Radius (m)
                  </label>
                  <input
                    type="number"
                    value={editingWorkplace.radiusM}
                    onChange={(e) =>
                      setEditingWorkplace({
                        ...editingWorkplace,
                        radiusM: parseInt(e.target.value, 10) || 100,
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">QR Mode</label>
                  <select
                    value={editingWorkplace.qrMode}
                    onChange={(e) =>
                      setEditingWorkplace({
                        ...editingWorkplace,
                        qrMode: e.target.value as any,
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="rotating">HMAC Rotating QR</option>
                    <option value="static">Static Entrance QR</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    QR Rotation (seconds)
                  </label>
                  <input
                    type="number"
                    value={editingWorkplace.qrRotationSeconds}
                    onChange={(e) =>
                      setEditingWorkplace({
                        ...editingWorkplace,
                        qrRotationSeconds: parseInt(e.target.value, 10) || 30,
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingWorkplace(null)}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold shadow-lg shadow-indigo-600/30"
                >
                  {submitting ? "Saving Changes…" : "Save Workplace Settings"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Workplace Modal with Interactive Map & Current Location GPS Picker */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn overflow-y-auto">
          <div className="glass-card max-w-2xl w-full rounded-3xl p-6 border border-slate-800 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-xl font-bold text-white">Create New Workplace</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Set location via interactive map pin or your current GPS location
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateWorkplace} className="space-y-5 text-xs">
              {/* Interactive Map Picker & Current Location button */}
              <WorkplaceMapPicker
                latitude={latitude}
                longitude={longitude}
                radiusM={radiusM}
                onChangeLocation={(lat, lng, addr) => {
                  setLatitude(lat);
                  setLongitude(lng);
                  if (addr) setAddress(addr);
                }}
              />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Workplace Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Headquarters / North Branch"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Physical Address</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Tech Avenue, Financial District"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={latitude}
                    onChange={(e) => setLatitude(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white font-mono focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={longitude}
                    onChange={(e) => setLongitude(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white font-mono focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Geofence Radius (m)
                  </label>
                  <input
                    type="number"
                    value={radiusM}
                    onChange={(e) => setRadiusM(parseInt(e.target.value, 10) || 150)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">QR Mode</label>
                  <select
                    value={qrMode}
                    onChange={(e) => setQrMode(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="rotating">HMAC Rotating QR</option>
                    <option value="static">Static Entrance QR</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    QR Rotation (seconds)
                  </label>
                  <input
                    type="number"
                    value={qrRotationSeconds}
                    onChange={(e) => setQrRotationSeconds(parseInt(e.target.value, 10) || 30)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold shadow-lg shadow-indigo-600/30"
                >
                  {submitting ? "Creating…" : "Create Workplace"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
