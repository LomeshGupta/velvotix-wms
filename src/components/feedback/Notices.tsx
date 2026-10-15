"use client";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { friendlyMessage } from "@/lib/api-client";

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert severity="error" action={onRetry ? <Button color="inherit" size="small" onClick={onRetry}>Try again</Button> : undefined}>
      {friendlyMessage(error)}
    </Alert>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <Box sx={{ py: 6, textAlign: "center" }}>
      <Typography variant="subtitle1">{title}</Typography>
      {hint && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 420, mx: "auto" }}>{hint}</Typography>}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  );
}

export function LedgerSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Stack spacing={1} aria-hidden>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} variant="rectangular" height={44} />)}
    </Stack>
  );
}
