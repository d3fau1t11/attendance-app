import React from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Clock,
  Building2,
  Users,
  ShieldAlert,
  FolderGit2,
  LogOut,
  MapPin,
  Sparkles,
} from "lucide-react";
import { clearSession, getStoredUser } from "../lib/api";

export function Sidebar() {
  const [location] = useLocation();
  const user = getStoredUser();

  const handleLogout = () => {
    clearSession();
    window.location.href = "/login";
  };

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/attendance", label: "Attendance Logs", icon: Clock },
    { href: "/workplaces", label: "Workplaces & QR", icon: MapPin },
    { href: "/employees", label: "Employees", icon: Users },
    { href: "/departments", label: "Departments", icon: FolderGit2 },
    { href: "/signals", label: "Anomaly Signals", icon: ShieldAlert },
  ];

  return (
    <aside className="w-64 glass-panel border-r border-slate-800/80 flex flex-col justify-between h-screen sticky top-0 z-30 select-none">
      <div>
        {/* Brand Header */}
        <div className="p-6 border-b border-slate-800/80 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center glow-indigo text-white font-bold text-xl shadow-lg">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-white tracking-tight leading-tight">
              Attendance<span className="text-indigo-400">Pulse</span>
            </h1>
            <p className="text-xs text-slate-400 font-medium">Admin Portal</p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="p-4 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all duration-200 ${
                  isActive
                    ? "bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-lg shadow-indigo-600/30 font-semibold"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
              >
                <Icon
                  className={`w-5 h-5 transition-transform duration-200 ${
                    isActive ? "scale-110 text-white" : "text-slate-400"
                  }`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Admin User Footer */}
      <div className="p-4 border-t border-slate-800/80">
        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-lg bg-indigo-950 border border-indigo-700/50 text-indigo-300 font-bold flex items-center justify-center text-sm shrink-0">
              {user?.fullName ? user.fullName[0].toUpperCase() : "A"}
            </div>
            <div className="truncate">
              <p className="text-xs font-semibold text-slate-200 truncate">
                {user?.fullName || "Admin User"}
              </p>
              <p className="text-[10px] text-indigo-400 font-medium uppercase tracking-wider">
                {user?.role?.replace("_", " ") || "Manager"}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
