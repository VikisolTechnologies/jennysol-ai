import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { verifyEmail } from "../lib/auth";
import { AuthLayout } from "./AuthLayout";

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }
    verifyEmail(token)
      .then(() => setStatus("ok"))
      .catch(() => setStatus("error"));
  }, [token]);

  return (
    <AuthLayout title="Email verification">
      {status === "checking" && <p className="text-sm text-neutral-500">Verifying…</p>}
      {status === "ok" && (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Your email is verified.{" "}
          <Link to="/" className="text-brand-500 hover:underline">
            Continue to Jennysol AI
          </Link>
          .
        </p>
      )}
      {status === "error" && (
        <p className="text-sm text-rose-500">
          That verification link is invalid or has expired. Request a new one from the app once you're logged in.
        </p>
      )}
    </AuthLayout>
  );
}
