"use client";
import AddBoxOutlined from "@mui/icons-material/AddBoxOutlined";
import ArrowForward from "@mui/icons-material/ArrowForward";
import AssignmentTurnedInOutlined from "@mui/icons-material/AssignmentTurnedInOutlined";
import Autorenew from "@mui/icons-material/Autorenew";
import FactCheck from "@mui/icons-material/FactCheck";
import Inventory2Outlined from "@mui/icons-material/Inventory2Outlined";
import LocalShipping from "@mui/icons-material/LocalShipping";
import MoveDown from "@mui/icons-material/MoveDown";
import MoveToInbox from "@mui/icons-material/MoveToInbox";
import QrCodeScanner from "@mui/icons-material/QrCodeScanner";
import Refresh from "@mui/icons-material/Refresh";
import SwapHoriz from "@mui/icons-material/SwapHoriz";
import Undo from "@mui/icons-material/Undo";
import VerifiedUserOutlined from "@mui/icons-material/VerifiedUserOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { QueueRibbon } from "@/components/dashboards/QueueRibbon";
import { EmptyState, ErrorNotice, LedgerSkeleton } from "@/components/feedback/Notices";
import { FreshnessLabel } from "@/components/feedback/FreshnessLabel";
import { StatusChip } from "@/components/feedback/StatusChip";
import { PageHeader } from "@/components/layout/PageHeader";
import { useDashboard, type TransactionRow } from "@/hooks/useWms";
import { MONO } from "@/theme/theme";

dayjs.extend(relativeTime);

const waitingText = (ms: number) => (ms <= 0 ? "" : ` Oldest waiting task: ${dayjs(Date.now() - ms).fromNow(true)}.`);

function Ledger({ rows, empty }: { rows: TransactionRow[]; empty: string }) {
  if (rows.length === 0) return <Typography color="text.secondary" sx={{ py: 2 }}>{empty}</Typography>;
  return (
    <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
      {rows.map((row) => (
        <Box component="li" key={row.id} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr auto", sm: "128px 1fr 150px 120px" }, gap: 1, alignItems: "center", py: 1.25, borderTop: 1, borderColor: "divider", borderLeft: 4, pl: 1.5, borderLeftColor: row.status === "Failed" || row.status === "Requires Reconciliation" ? "error.main" : row.status === "Processing" ? "secondary.main" : "transparent" }}>
          <Typography variant="body2" color="text.secondary" sx={{ gridColumn: { xs: "1 / -1", sm: "auto" } }}>{row.requestedAt ? dayjs(row.requestedAt).fromNow() : ""}</Typography>
          <Typography variant="body2"><strong>{row.operationType}</strong> · {row.locationCode}</Typography>
          <Box><StatusChip status={row.status} /></Box>
          <Typography variant="body2" sx={{ fontFamily: MONO, justifySelf: { sm: "end" } }}>{row.resultDocumentNo || row.errorCode || ""}</Typography>
        </Box>
      ))}
    </Box>
  );
}

/** Icon-led task cards are only a navigation layer; each target page keeps its existing workflow. */
const WORKSPACES = [
  { href: "/inbound/receiving", title: "Receive goods", detail: "Goods coming in", permission: "receiving:submit", icon: <MoveToInbox />, tint: "#E6F2FF", ink: "#155A9C" },
  { href: "/inbound/putaway", title: "Put stock away", detail: "Move goods to a shelf or bin", permission: "putaway:submit", icon: <MoveDown />, tint: "#EDE9FE", ink: "#5B35A5" },
  { href: "/inventory/movements", title: "Move stock", detail: "Move goods to another bin", permission: "movements:submit", icon: <SwapHoriz />, tint: "#E7F6F4", ink: "#08786D" },
  { href: "/outbound/picking", title: "Pick an order", detail: "Collect items for an order", permission: "picking:submit", icon: <QrCodeScanner />, tint: "#FFF0D1", ink: "#8A5000" },
  { href: "/outbound/packing", title: "Pack an order", detail: "Check items before sending", permission: "packing:submit", icon: <AddBoxOutlined />, tint: "#E3F4FF", ink: "#075985" },
  { href: "/outbound/shipping", title: "Send an order", detail: "Finish dispatch", permission: "shipping:submit", icon: <LocalShipping />, tint: "#E3F7E9", ink: "#166534" },
  { href: "/inventory/cycle-count", title: "Count stock", detail: "Count goods on a shelf", permission: "cyclecounts:submit", icon: <FactCheck />, tint: "#F0F3F6", ink: "#34495E" },
  { href: "/inventory/adjustments", title: "Fix stock count", detail: "Correct a stock difference", permission: "inventory:adjust", icon: <Autorenew />, tint: "#FDE8E7", ink: "#A12622" },
  { href: "/returns", title: "Returned goods", detail: "Goods brought back", permission: "returns:submit", icon: <Undo />, tint: "#FFF0E5", ink: "#A34300" },
  { href: "/quality/inspection", title: "Check goods", detail: "Approve or hold goods", permission: "quality:submit", icon: <VerifiedUserOutlined />, tint: "#E3F7E9", ink: "#166534" },
  { href: "/inventory/items", title: "Find an item", detail: "Look up item and stock", permission: "items:view", icon: <Inventory2Outlined />, tint: "#E6F2FF", ink: "#155A9C" },
  { href: "/tasks", title: "Task status", detail: "See sent and finished work", permission: "transactions:view", icon: <AssignmentTurnedInOutlined />, tint: "#F0EAFE", ink: "#5B35A5" },
] as const;

export function DashboardView({ permissions }: { permissions: string[]; roles: string[] }) {
  const { data, error, isLoading, refetch, isFetching } = useDashboard();
  const allowedWorkspaces = WORKSPACES.filter((item) => permissions.includes(item.permission));
  const attention = data?.recent.filter((row) => row.status === "Failed" || row.status === "Requires Reconciliation") ?? [];
  const inProgress = data?.counts["Processing"] ?? 0;
  const waiting = (data?.counts["Submitted"] ?? 0) + (data?.counts["Queued"] ?? 0);
  const needsCheck = (data?.counts["Failed"] ?? 0) + (data?.counts["Requires Reconciliation"] ?? 0);

  return (
    <>
      <PageHeader
        title="Choose a task"
        subtitle="Tap a picture to start."
        actions={
          <Tooltip title="Refresh task status">
            <span>
              <IconButton aria-label="Refresh task status" onClick={() => void refetch()} disabled={isFetching} sx={{ width: 48, height: 48 }}>
                <Refresh />
              </IconButton>
            </span>
          </Tooltip>
        }
      />

      {error && <ErrorNotice error={error} onRetry={() => void refetch()} />}

      <Box component="section" aria-label="Available warehouse tasks" sx={{ mb: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <QrCodeScanner color="primary" sx={{ fontSize: 30 }} />
          <Box>
            <Typography variant="h2" component="h2">What do you need to do?</Typography>
            <Typography variant="body2" color="text.secondary">Choose the picture that matches your job.</Typography>
          </Box>
        </Stack>

        {allowedWorkspaces.length === 0 ? (
          <Paper sx={{ p: 3, textAlign: "center" }}>
            <Typography variant="h3" sx={{ mb: 1 }}>No tasks assigned</Typography>
            <Typography color="text.secondary">Ask your supervisor to assign WMS work to your user.</Typography>
          </Paper>
        ) : (
          <Box sx={{ display: "grid", gap: { xs: 1.25, sm: 1.75, lg: 2 }, gridTemplateColumns: { xs: "repeat(2,minmax(0,1fr))", sm: "repeat(3,minmax(0,1fr))", xl: "repeat(4,minmax(0,1fr))" } }}>
            {allowedWorkspaces.map((item) => (
              <Paper
                key={item.href}
                component={Link}
                href={item.href}
                variant="outlined"
                sx={{
                  minHeight: { xs: 158, sm: 176, lg: 190 },
                  p: { xs: 1.5, sm: 2 },
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 1,
                  textDecoration: "none",
                  color: "inherit",
                  borderWidth: 2,
                  borderRadius: 2,
                  bgcolor: "background.paper",
                  transition: "transform .12s ease, border-color .12s ease, box-shadow .12s ease",
                  "&:hover": { borderColor: item.ink, boxShadow: 2, transform: "translateY(-1px)" },
                  "&:active": { transform: "scale(.985)" },
                  "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: 2 },
                }}
              >
                <Box sx={{ width: { xs: 54, sm: 64 }, height: { xs: 54, sm: 64 }, borderRadius: 2, bgcolor: item.tint, color: item.ink, display: "grid", placeItems: "center", "& .MuiSvgIcon-root": { fontSize: { xs: 34, sm: 40 } } }}>
                  {item.icon}
                </Box>
                <Box sx={{ width: "100%" }}>
                  <Typography sx={{ fontSize: { xs: "1rem", sm: "1.1rem" }, lineHeight: 1.2, fontWeight: 800, mb: 0.5 }}>
                    {item.title}
                  </Typography>
                  <Typography sx={{ fontSize: { xs: "0.78rem", sm: "0.88rem" }, lineHeight: 1.3, color: "text.secondary" }}>
                    {item.detail}
                  </Typography>
                </Box>
                <ArrowForward sx={{ alignSelf: "flex-end", color: item.ink, fontSize: 22 }} />
              </Paper>
            ))}
          </Box>
        )}
      </Box>

      <Divider sx={{ my: 2.5 }} />

      {isLoading && <LedgerSkeleton rows={4} />}
      {data && (
        <Stack spacing={{ xs: 2.5, md: 3 }}>
          <Paper sx={{ p: { xs: 1.5, sm: 2.5 } }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
              <Box>
                <Typography variant="h2" component="h2">Task status</Typography>
                <Typography variant="body2" color="text.secondary">Last updated: <FreshnessLabel generatedAt={data.generatedAt} maxAgeSeconds={data.maxAgeSeconds} /></Typography>
              </Box>
              <Box sx={{ display: { xs: "none", sm: "block" } }}>
                <Typography variant="caption" color="text.secondary">Latest activity</Typography>
              </Box>
            </Stack>
            <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
              <StatusCount label="Waiting" count={waiting} tint="#E6F2FF" ink="#155A9C" />
              <StatusCount label="Working" count={inProgress} tint="#FFF0D1" ink="#8A5000" />
              <StatusCount label="Check" count={needsCheck} tint="#FDE8E7" ink="#A12622" />
            </Box>
            <Box sx={{ mt: 2 }}>
              <QueueRibbon counts={data.counts} />
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
                {waiting} waiting, {inProgress} in progress, {needsCheck} need checking.{waitingText(data.oldestWaitingMs)}

              </Typography>
            </Box>
          </Paper>

          <Box sx={{ display: "grid", gap: { xs: 2.5, lg: 3 }, gridTemplateColumns: { xs: "1fr", lg: "minmax(0,3fr) minmax(260px,2fr)" } }}>
            <Box>
              <Typography variant="h2" component="h2" sx={{ mb: 1 }}>Needs checking</Typography>
              <Paper sx={{ px: { xs: 1.5, sm: 2 }, py: 0.5 }}>
                <Ledger rows={attention} empty="Nothing needs checking." />
              </Paper>
              {attention.length > 0 && <Button component={Link} href="/tasks" sx={{ mt: 1, minHeight: 48 }}>See all tasks</Button>}
              <Divider sx={{ my: 2.5 }} />
              <Typography variant="h2" component="h2" sx={{ mb: 1 }}>Recent work</Typography>
              {data.recent.length === 0
                ? <EmptyState title="No work yet" hint="Start by choosing a task above." />
                : <Paper sx={{ px: { xs: 1.5, sm: 2 }, py: 0.5 }}><Ledger rows={data.recent} empty="" /></Paper>}
            </Box>
            <Box>
              <Typography variant="h2" component="h2" sx={{ mb: 1 }}>Work by type</Typography>
              <Paper sx={{ p: 1.5 }}>
                {Object.keys(data.byType).length === 0 ? (
                  <Typography color="text.secondary">No completed work to show.</Typography>
                ) : (
                  <Box sx={{ height: 260 }} role="img" aria-label={`Transactions by operation: ${Object.entries(data.byType).map(([key, value]) => `${key} ${value}`).join(", ")}`}>
                    <ResponsiveContainer>
                      <BarChart data={Object.entries(data.byType).map(([name, value]) => ({ name, value }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11 }} />
                        <ChartTooltip cursor={{ fillOpacity: 0.08 }} />
                        <Bar dataKey="value" name="Tasks" fill="#3B5B7A" radius={[0, 2, 2, 0]} barSize={22} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                )}
              </Paper>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                Based on the latest {data.sampleSize} tasks{data.sampleSize >= data.sampleLimit ? ` (limit ${data.sampleLimit})` : ""} in your warehouses.
              </Typography>
            </Box>
          </Box>
        </Stack>
      )}
    </>
  );
}

function StatusCount({ label, count, tint, ink }: { label: string; count: number; tint: string; ink: string }) {
  return (
    <Box sx={{ p: { xs: 1, sm: 1.5 }, minWidth: 0, borderRadius: 1.5, bgcolor: tint, color: ink }}>
      <Typography sx={{ fontSize: { xs: "1.5rem", sm: "1.9rem" }, fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{count}</Typography>
      <Typography sx={{ fontSize: { xs: "0.72rem", sm: "0.9rem" }, fontWeight: 700, mt: 0.5 }}>{label}</Typography>
    </Box>
  );
}
