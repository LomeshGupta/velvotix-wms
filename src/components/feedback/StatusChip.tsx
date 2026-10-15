"use client";
import Chip from "@mui/material/Chip";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutline";
import ErrorOutline from "@mui/icons-material/ErrorOutline";
import HourglassEmpty from "@mui/icons-material/HourglassEmpty";
import PlayCircleOutline from "@mui/icons-material/PlayCircleOutline";
import ReportProblemOutlined from "@mui/icons-material/ReportProblemOutlined";
import RemoveCircleOutline from "@mui/icons-material/RemoveCircleOutline";
import type { ReactElement } from "react";

type Tone = "default" | "primary" | "secondary" | "success" | "error" | "warning";
interface Entry { label: string; tone: Tone; icon: ReactElement; variant?: "filled" | "outlined" }
const MAP: Record<string, Entry> = {
  Draft: { label: "Draft", tone: "default", icon: <HourglassEmpty /> , variant: "outlined" },
  Submitted: { label: "Waiting", tone: "primary", icon: <HourglassEmpty />, variant: "outlined" },
  Queued: { label: "Waiting", tone: "primary", icon: <HourglassEmpty />, variant: "outlined" },
  Processing: { label: "In progress", tone: "secondary", icon: <PlayCircleOutline /> },
  "Awaiting Approval": { label: "Needs approval", tone: "warning", icon: <ReportProblemOutlined />, variant: "outlined" },
  Completed: { label: "Completed", tone: "success", icon: <CheckCircleOutline /> },
  "Partially Completed": { label: "Partly done", tone: "warning", icon: <ReportProblemOutlined /> },
  Failed: { label: "Failed", tone: "error", icon: <ErrorOutline /> },
  Cancelled: { label: "Cancelled", tone: "default", icon: <RemoveCircleOutline />, variant: "outlined" },
  "Requires Reconciliation": { label: "Check outcome", tone: "error", icon: <ReportProblemOutlined />, variant: "outlined" },
};

/** Status is always text plus an icon, never colour alone. */
export function StatusChip({ status }: { status: string }) {
  const m: Entry = MAP[status] ?? { label: status, tone: "default", icon: <HourglassEmpty /> };
  return <Chip size="small" label={m.label} color={m.tone} variant={m.variant ?? "filled"} icon={m.icon} />;
}

export const STATUS_LABEL = (s: string) => MAP[s]?.label ?? s;
