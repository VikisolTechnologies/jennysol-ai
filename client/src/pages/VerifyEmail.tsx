import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { verifyEmail } from "../lib/auth";
import { JennyAuthChrome, JennyQuestion, JennyCommentary } from "./jennysol/JennyAuthChrome";

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
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
    <JennyAuthChrome
      step={1}
      totalSteps={1}
      onBack={() => navigate("/login")}
      onPrimary={() => navigate(status === "ok" ? "/" : "/login")}
      primaryDisabled={status === "checking"}
    >
      {status === "checking" && (
        <>
          <JennyQuestion>Verifying your email…</JennyQuestion>
        </>
      )}
      {status === "ok" && (
        <>
          <JennyQuestion>Your email is verified.</JennyQuestion>
          <JennyCommentary>Continue to JennySol whenever you're ready.</JennyCommentary>
        </>
      )}
      {status === "error" && (
        <>
          <JennyQuestion>That link is invalid or expired.</JennyQuestion>
          <JennyCommentary>Request a new one from the app once you're signed in.</JennyCommentary>
        </>
      )}
    </JennyAuthChrome>
  );
}
