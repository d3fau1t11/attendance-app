import React from "react";
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  colorTheme?: "indigo" | "emerald" | "amber" | "rose" | "cyan";
  badge?: string;
}

export function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  colorTheme = "indigo",
  badge,
}: StatsCardProps) {
  const themeStyles = {
    indigo: {
      border: "border-indigo-500/20 hover:border-indigo-500/40",
      bg: "bg-indigo-950/30",
      iconBg: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20",
      glow: "glow-indigo",
    },
    emerald: {
      border: "border-emerald-500/20 hover:border-emerald-500/40",
      bg: "bg-emerald-950/30",
      iconBg: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
      glow: "glow-emerald",
    },
    amber: {
      border: "border-amber-500/20 hover:border-amber-500/40",
      bg: "bg-amber-950/30",
      iconBg: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
      glow: "glow-amber",
    },
    rose: {
      border: "border-rose-500/20 hover:border-rose-500/40",
      bg: "bg-rose-950/30",
      iconBg: "bg-rose-500/10 text-rose-400 border border-rose-500/20",
      glow: "",
    },
    cyan: {
      border: "border-cyan-500/20 hover:border-cyan-500/40",
      bg: "bg-cyan-950/30",
      iconBg: "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20",
      glow: "",
    },
  }[colorTheme];

  return (
    <div
      className={`glass-card rounded-2xl p-5 border transition-all duration-300 ${themeStyles.border} ${themeStyles.bg}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {title}
        </span>
        <div className={`p-2.5 rounded-xl ${themeStyles.iconBg}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>

      <div className="mt-4 flex items-baseline justify-between">
        <span className="text-3xl font-bold text-white tracking-tight font-heading">
          {value}
        </span>
        {badge && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            {badge}
          </span>
        )}
      </div>

      {subtitle && <p className="text-xs text-slate-400 mt-2 font-medium">{subtitle}</p>}
    </div>
  );
}
