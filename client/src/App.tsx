import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useViewportHeight } from "./lib/useViewportHeight";
import { MainApp } from "./components/MainApp";
import { RequireAuth } from "./components/RequireAuth";
import { RequireAdmin } from "./components/RequireAdmin";

// MainApp (the core chat experience at "/") stays eagerly bundled — it's
// what's on screen immediately after auth resolves, so splitting it off
// would trade the bundle-size warning for a Suspense flash on the one
// route that can never show a blank frame. Everything below is only ever
// needed after a navigation, so it's safe to split into its own chunk.
const Landing = lazy(() => import("./pages/Landing").then((m) => ({ default: m.Landing })));
const Privacy = lazy(() => import("./pages/Privacy").then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import("./pages/Terms").then((m) => ({ default: m.Terms })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const Signup = lazy(() => import("./pages/Signup").then((m) => ({ default: m.Signup })));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword").then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import("./pages/ResetPassword").then((m) => ({ default: m.ResetPassword })));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail").then((m) => ({ default: m.VerifyEmail })));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout").then((m) => ({ default: m.AdminLayout })));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers").then((m) => ({ default: m.AdminUsers })));
const AdminUserDetail = lazy(() => import("./pages/admin/AdminUserDetail").then((m) => ({ default: m.AdminUserDetail })));
const AdminErrors = lazy(() => import("./pages/admin/AdminErrors").then((m) => ({ default: m.AdminErrors })));
const AgentSessions = lazy(() => import("./pages/admin/AgentSessions").then((m) => ({ default: m.AgentSessions })));
const AgentSessionDetail = lazy(() =>
  import("./pages/admin/AgentSessionDetail").then((m) => ({ default: m.AgentSessionDetail }))
);
const AccountLayout = lazy(() => import("./pages/account/AccountLayout").then((m) => ({ default: m.AccountLayout })));
const AccountProfile = lazy(() => import("./pages/account/AccountProfile").then((m) => ({ default: m.AccountProfile })));
const AccountSecurity = lazy(() => import("./pages/account/AccountSecurity").then((m) => ({ default: m.AccountSecurity })));
const AccountSessions = lazy(() => import("./pages/account/AccountSessions").then((m) => ({ default: m.AccountSessions })));
const AccountAppearance = lazy(() => import("./pages/account/AccountAppearance").then((m) => ({ default: m.AccountAppearance })));
const AccountPrivacy = lazy(() => import("./pages/account/AccountPrivacy").then((m) => ({ default: m.AccountPrivacy })));
const Agents = lazy(() => import("./pages/Agents").then((m) => ({ default: m.Agents })));
const Files = lazy(() => import("./pages/Files").then((m) => ({ default: m.Files })));
const Memory = lazy(() => import("./pages/Memory").then((m) => ({ default: m.Memory })));
const Tasks = lazy(() => import("./pages/Tasks").then((m) => ({ default: m.Tasks })));
const Integrations = lazy(() => import("./pages/Integrations").then((m) => ({ default: m.Integrations })));

export default function App() {
  useViewportHeight();

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/welcome" element={<Landing />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <MainApp />
            </RequireAuth>
          }
        />
        <Route
          path="/agents"
          element={
            <RequireAuth>
              <Agents />
            </RequireAuth>
          }
        />
        <Route
          path="/files"
          element={
            <RequireAuth>
              <Files />
            </RequireAuth>
          }
        />
        <Route
          path="/memory"
          element={
            <RequireAuth>
              <Memory />
            </RequireAuth>
          }
        />
        <Route
          path="/tasks"
          element={
            <RequireAuth>
              <Tasks />
            </RequireAuth>
          }
        />
        <Route
          path="/integrations"
          element={
            <RequireAuth>
              <Integrations />
            </RequireAuth>
          }
        />
        <Route
          path="/account"
          element={
            <RequireAuth>
              <AccountLayout />
            </RequireAuth>
          }
        >
          <Route index element={<AccountProfile />} />
          <Route path="security" element={<AccountSecurity />} />
          <Route path="sessions" element={<AccountSessions />} />
          <Route path="appearance" element={<AccountAppearance />} />
          <Route path="privacy" element={<AccountPrivacy />} />
        </Route>
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            </RequireAuth>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="users/:id" element={<AdminUserDetail />} />
          <Route path="errors" element={<AdminErrors />} />
          <Route path="agent-sessions" element={<AgentSessions />} />
          <Route path="agent-sessions/:id" element={<AgentSessionDetail />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
