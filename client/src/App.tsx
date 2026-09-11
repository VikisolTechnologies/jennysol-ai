import { Navigate, Route, Routes } from "react-router-dom";
import { useViewportHeight } from "./lib/useViewportHeight";
import { MainApp } from "./components/MainApp";
import { RequireAuth } from "./components/RequireAuth";
import { RequireAdmin } from "./components/RequireAdmin";
import { Landing } from "./pages/Landing";
import { Privacy } from "./pages/Privacy";
import { Terms } from "./pages/Terms";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { VerifyEmail } from "./pages/VerifyEmail";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { AdminUsers } from "./pages/admin/AdminUsers";
import { AdminUserDetail } from "./pages/admin/AdminUserDetail";
import { AdminErrors } from "./pages/admin/AdminErrors";
import { AccountLayout } from "./pages/account/AccountLayout";
import { AccountProfile } from "./pages/account/AccountProfile";
import { AccountSecurity } from "./pages/account/AccountSecurity";
import { AccountSessions } from "./pages/account/AccountSessions";
import { AccountAppearance } from "./pages/account/AccountAppearance";
import { AccountPrivacy } from "./pages/account/AccountPrivacy";
import { Agents } from "./pages/Agents";

export default function App() {
  useViewportHeight();

  return (
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
