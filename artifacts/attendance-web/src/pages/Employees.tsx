import React, { useEffect, useState } from "react";
import { Users, UserPlus, Search, Shield, Building, Mail, Phone, Lock } from "lucide-react";
import { Header } from "../components/Header";
import { apiRequest } from "../lib/api";

interface Employee {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  role: "super_admin" | "company_admin" | "manager" | "employee";
  employeeCode: string;
  jobTitle: string | null;
  phone: string | null;
  isActive: boolean;
  departmentId: string | null;
  departmentName: string | null;
  createdAt: string;
}

interface Department {
  id: string;
  name: string;
}

export function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Onboard modal state
  const [showModal, setShowModal] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"employee" | "manager" | "company_admin">("employee");
  const [departmentId, setDepartmentId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [empRes, deptRes] = await Promise.all([
        apiRequest<{ employees: Employee[] }>("/admin/employees"),
        apiRequest<{ departments: Department[] }>("/admin/departments"),
      ]);
      setEmployees(empRes.employees || []);
      setDepartments(deptRes.departments || []);
    } catch (err) {
      console.error("Failed to load employee directory", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOnboard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !email || !password || !employeeCode) return;

    setSubmitting(true);
    try {
      await apiRequest("/admin/employees", {
        method: "POST",
        body: JSON.stringify({
          fullName,
          email,
          password,
          employeeCode,
          jobTitle,
          phone,
          role,
          departmentId: departmentId || undefined,
        }),
      });
      setShowModal(false);
      setFullName("");
      setEmail("");
      setPassword("");
      setEmployeeCode("");
      fetchData();
    } catch (err: any) {
      alert(err.message || "Failed to onboard employee.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (emp: Employee) => {
    try {
      await apiRequest(`/admin/employees/${emp.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !emp.isActive }),
      });
      fetchData();
    } catch (err: any) {
      alert(err.message || "Failed to update employee status.");
    }
  };

  const filteredEmployees = employees.filter((e) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      e.fullName.toLowerCase().includes(term) ||
      e.email.toLowerCase().includes(term) ||
      e.employeeCode.toLowerCase().includes(term) ||
      (e.jobTitle && e.jobTitle.toLowerCase().includes(term))
    );
  });

  return (
    <div className="flex-1 min-h-screen bg-slate-950 pb-12">
      <Header
        title="Employee Directory"
        subtitle="Manage personnel, manager access scopes, and role permissions"
        onRefresh={fetchData}
        isRefreshing={loading}
      />

      <main className="px-8 mt-8 space-y-6 max-w-7xl mx-auto">
        {/* Top Controls */}
        <div className="glass-card p-4 rounded-2xl border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email or code…"
              className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none transition-colors"
            />
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Onboard Employee</span>
          </button>
        </div>

        {/* Directory Table */}
        <div className="glass-card rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-900/60 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-4 px-6">Person</th>
                  <th className="py-4 px-6">Code & Role</th>
                  <th className="py-4 px-6">Department</th>
                  <th className="py-4 px-6">Job Title</th>
                  <th className="py-4 px-6">Status</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500">
                      Loading employee directory…
                    </td>
                  </tr>
                ) : filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500">
                      No employees match your search query.
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-slate-900/40 transition-colors">
                      {/* Name & Email */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-indigo-950 border border-indigo-700/50 text-indigo-300 font-bold flex items-center justify-center text-sm shrink-0">
                            {emp.fullName[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-white">{emp.fullName}</p>
                            <p className="text-[11px] text-slate-400 font-mono">{emp.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Code & Role */}
                      <td className="py-4 px-6">
                        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 block w-max">
                          {emp.employeeCode}
                        </span>
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wider block mt-1 ${
                            emp.role === "company_admin"
                              ? "text-indigo-400"
                              : emp.role === "manager"
                              ? "text-emerald-400"
                              : "text-slate-400"
                          }`}
                        >
                          {emp.role.replace("_", " ")}
                        </span>
                      </td>

                      {/* Department */}
                      <td className="py-4 px-6 font-medium text-slate-300">
                        {emp.departmentName || "—"}
                      </td>

                      {/* Job Title */}
                      <td className="py-4 px-6 text-slate-400">
                        {emp.jobTitle || "Not specified"}
                      </td>

                      {/* Active Status */}
                      <td className="py-4 px-6">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            emp.isActive
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              emp.isActive ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
                            }`}
                          />
                          <span>{emp.isActive ? "ACTIVE" : "INACTIVE"}</span>
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-6 text-right">
                        <button
                          onClick={() => handleToggleActive(emp)}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium cursor-pointer"
                        >
                          {emp.isActive ? "Deactivate" : "Activate"}
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

      {/* Onboard Employee Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="glass-card max-w-lg w-full rounded-2xl p-6 border border-slate-800 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="text-lg font-bold text-white">Onboard New Employee</h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleOnboard} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Employee Code</label>
                  <input
                    type="text"
                    value={employeeCode}
                    onChange={(e) => setEmployeeCode(e.target.value)}
                    placeholder="EMP-1024"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white font-mono focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Corporate Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane.doe@company.com"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Temporary Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Job Title</label>
                  <input
                    type="text"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="Software Engineer"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">System Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="company_admin">Company Admin</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Department</label>
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Unassigned</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
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
                  {submitting ? "Creating Account…" : "Register Employee"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
