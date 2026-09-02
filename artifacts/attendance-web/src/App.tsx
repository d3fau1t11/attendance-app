import React from "react";
import { Route, Switch, Redirect } from "wouter";
import { getStoredToken } from "./lib/api";
import { Sidebar } from "./components/Sidebar";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Attendance } from "./pages/Attendance";
import { Workplaces } from "./pages/Workplaces";
import { Employees } from "./pages/Employees";
import { Departments } from "./pages/Departments";
import { Signals } from "./pages/Signals";

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const token = getStoredToken();
  if (!token) {
    return <Redirect to="/login" />;
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar />
      <div className="flex-1 overflow-x-hidden">{children}</div>
    </div>
  );
}

export function App() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <ProtectedLayout>
          <Dashboard />
        </ProtectedLayout>
      </Route>
      <Route path="/attendance">
        <ProtectedLayout>
          <Attendance />
        </ProtectedLayout>
      </Route>
      <Route path="/workplaces">
        <ProtectedLayout>
          <Workplaces />
        </ProtectedLayout>
      </Route>
      <Route path="/employees">
        <ProtectedLayout>
          <Employees />
        </ProtectedLayout>
      </Route>
      <Route path="/departments">
        <ProtectedLayout>
          <Departments />
        </ProtectedLayout>
      </Route>
      <Route path="/signals">
        <ProtectedLayout>
          <Signals />
        </ProtectedLayout>
      </Route>
      <Route>
        <Redirect to="/" />
      </Route>
    </Switch>
  );
}

export default App;
