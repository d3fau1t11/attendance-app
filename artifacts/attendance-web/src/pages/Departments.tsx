import React, { useEffect, useState } from "react";
import { FolderGit2, Plus, Building2, Users } from "lucide-react";
import { Header } from "../components/Header";
import { apiRequest } from "../lib/api";

interface Department {
  id: string;
  name: string;
  createdAt?: string;
}

export function Departments() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchDepartments = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ departments: Department[] }>("/admin/departments");
      setDepartments(res.departments || []);
    } catch (err) {
      console.error("Failed to load departments", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDepartments();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    setSubmitting(true);
    try {
      await apiRequest("/admin/departments", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setShowModal(false);
      setName("");
      fetchDepartments();
    } catch (err: any) {
      alert(err.message || "Failed to create department.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 min-h-screen bg-slate-950 pb-12">
      <Header
        title="Departments"
        subtitle="Organizational groupings and manager authorization boundaries"
        onRefresh={fetchDepartments}
        isRefreshing={loading}
      />

      <main className="px-8 mt-8 space-y-8 max-w-7xl mx-auto">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Active Departments</h2>
            <p className="text-xs text-slate-400">
              Group employees by division for scoped manager reporting
            </p>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Department</span>
          </button>
        </div>

        {/* Departments Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading ? (
            <div className="col-span-full py-12 text-center text-slate-500 text-sm">
              Loading departments…
            </div>
          ) : departments.length === 0 ? (
            <div className="col-span-full py-12 text-center text-slate-500 text-sm">
              No departments configured yet. Click "Create Department" to get started.
            </div>
          ) : (
            departments.map((dept) => (
              <div
                key={dept.id}
                className="glass-card rounded-2xl p-6 border border-slate-800 flex items-center justify-between hover:border-indigo-500/40 transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="p-3.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    <FolderGit2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white tracking-tight">{dept.name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Department ID: {dept.id.substring(0, 8)}…</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="glass-card max-w-md w-full rounded-2xl p-6 border border-slate-800 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="text-lg font-bold text-white">Create Department</h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Department Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Engineering / Operations / Finance"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow-lg shadow-indigo-600/30"
                >
                  {submitting ? "Saving…" : "Create Department"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
