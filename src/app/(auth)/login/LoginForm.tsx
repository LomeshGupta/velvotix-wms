"use client";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError } from "@/services/api/bcRequest";
import { login } from "@/services/api/authService";

export function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(userId, password);
      // Only follow same-site relative paths.
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "RATE_LIMITED") setError("Too many attempts. Wait a few minutes and try again.");
      else if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") setError("User ID or password is not correct. After several failed attempts the account is locked for a while.");
      else if (err instanceof ApiError && err.code === "NO_WMS_PERMISSIONS") setError("Login was verified by Business Central, but this user has no WMS permissions. Ask your administrator to assign an enabled WMS role and permissions.");
      else if (err instanceof ApiError && err.status === 0) setError("Could not reach the server. Check your connection.");
      else setError("Sign in is unavailable right now. Try again, or contact an administrator.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100dvh", display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(320px, 5fr) 7fr" } }}>
      <Box sx={{ bgcolor: "ink", color: "#E6EDF3", p: { xs: 3, md: 6 }, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: { xs: 140, md: "auto" } }}>
        <Typography variant="h2" component="p" sx={{ color: "#fff" }}>Velvotix WMS</Typography>
        <Typography sx={{ display: { xs: "none", md: "block" }, maxWidth: 360, color: "#9AA9B7" }}>
          Receive, move and ship stock on the dock floor. Every transaction is saved in Business Central first and shows its real status.
        </Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 3 }}>
        <Box component="form" onSubmit={submit} sx={{ width: "100%", maxWidth: 380 }}>
          <Typography variant="h1" sx={{ mb: 3 }}>Sign in</Typography>
          <Stack spacing={2}>
            {error && <Alert severity="error" role="alert">{error}</Alert>}
            <TextField label="User ID" value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="username" autoFocus required size="medium" />
            <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required size="medium" />
            <Button type="submit" variant="contained" size="large" disabled={busy || !userId || !password}>{busy ? "Signing in" : "Sign in"}</Button>
            <Box sx={{ mt: 2, p: 2, border: 1, borderColor: "divider", borderRadius: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Demo accounts · mock mode</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>Choose a role to fill its demo credentials. Mock data is simulated and never posts to Business Central.</Typography>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {[
                  ["ADMIN", "MockAdmin!2026"],
                  ["MANAGER", "Manager!2026"],
                  ["RECEIVER", "Operator!2026"],
                  ["PICKER", "Operator!2026"],
                  ["SHIPPER", "Operator!2026"],
                  ["AUDITOR", "Auditor!2026"],
                ].map(([id, pw]) => (
                  <Button key={id} size="small" variant="outlined" onClick={() => { setUserId(id.toLowerCase()); setPassword(pw); }}>
                    {id.charAt(0) + id.slice(1).toLowerCase()}
                  </Button>
                ))}
              </Stack>
            </Box>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
