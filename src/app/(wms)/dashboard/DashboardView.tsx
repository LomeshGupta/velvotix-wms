"use client";
import Refresh from "@mui/icons-material/Refresh";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import Link from "next/link";
import ArrowForward from "@mui/icons-material/ArrowForward";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { QueueRibbon } from "@/components/dashboards/QueueRibbon";
import { EmptyState, ErrorNotice, LedgerSkeleton } from "@/components/feedback/Notices";
import { FreshnessLabel } from "@/components/feedback/FreshnessLabel";
import { StatusChip } from "@/components/feedback/StatusChip";
import { PageHeader } from "@/components/layout/PageHeader";
import { useDashboard, type TransactionRow } from "@/hooks/useWms";
import { MONO } from "@/theme/theme";

dayjs.extend(relativeTime);

const waitingText = (ms: number) => (ms <= 0 ? "" : ` Oldest waiting item: ${dayjs(Date.now() - ms).fromNow(true)}.`);

function Ledger({ rows, empty }: { rows: TransactionRow[]; empty: string }) {
  if (rows.length === 0) return <Typography color="text.secondary" sx={{ py: 2 }}>{empty}</Typography>;
  return (
    <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
      {rows.map((r) => (
        <Box component="li" key={r.id} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr auto", sm: "128px 1fr 150px 120px" }, gap: 1, alignItems: "center", py: 1.25, borderTop: 1, borderColor: "divider", borderLeft: 4, pl: 1.5, borderLeftColor: r.status === "Failed" || r.status === "Requires Reconciliation" ? "error.main" : r.status === "Processing" ? "secondary.main" : "transparent" }}>
          <Typography variant="body2" color="text.secondary" sx={{ gridColumn: { xs: "1 / -1", sm: "auto" } }}>{r.requestedAt ? dayjs(r.requestedAt).fromNow() : ""}</Typography>
          <Typography variant="body2"><strong>{r.operationType}</strong> at {r.locationCode}</Typography>
          <Box><StatusChip status={r.status} /></Box>
          <Typography variant="body2" sx={{ fontFamily: MONO, justifySelf: { sm: "end" } }}>{r.resultDocumentNo || r.errorCode || ""}</Typography>
        </Box>
      ))}
    </Box>
  );
}

const WORKSPACES = [
  { href: "/inbound/receiving", title: "Receiving", detail: "Scan receipts and capture lot / serial tracking.", permission: "receiving:submit" },
  { href: "/inbound/putaway", title: "Put-away", detail: "Direct stock into storage bins.", permission: "putaway:submit" },
  { href: "/inventory/movements", title: "Inventory movement", detail: "Move stock between bins or assigned warehouses.", permission: "movements:submit" },
  { href: "/outbound/picking", title: "Picking", detail: "Scan picks against a BC warehouse shipment.", permission: "picking:submit" },
  { href: "/outbound/packing", title: "Packing station", detail: "Verify picked lines before dispatch.", permission: "packing:submit" },
  { href: "/outbound/shipping", title: "Shipping", detail: "Request shipment processing from Business Central.", permission: "shipping:submit" },
  { href: "/inventory/cycle-count", title: "Cycle count", detail: "Capture blind counts by barcode and quantity.", permission: "cyclecounts:submit" },
  { href: "/inventory/adjustments", title: "Adjustments", detail: "Request controlled inventory corrections.", permission: "inventory:adjust" },
  { href: "/returns", title: "Returns", detail: "Receive and classify returned goods.", permission: "returns:submit" },
  { href: "/quality/inspection", title: "Quality inspection", detail: "Release, hold, or reject inspected goods.", permission: "quality:submit" },
  { href: "/inventory/items", title: "Item and inventory lookup", detail: "Search item master data and BC inventory totals.", permission: "items:view" },
  { href: "/tasks", title: "Transaction audit", detail: "Track accepted, processing, failed, and completed work.", permission: "transactions:view" },
] as const;

export function DashboardView({ permissions, roles }: { permissions: string[]; roles: string[] }) {
  const { data, error, isLoading, refetch, isFetching } = useDashboard();
  const allowedWorkspaces = WORKSPACES.filter((item) => permissions.includes(item.permission));
  const workspaceTitle = permissions.includes("administration:administer") ? "Warehouse control tower" : permissions.includes("receiving:submit") ? "Receiving workspace" : permissions.includes("picking:submit") ? "Picking workspace" : permissions.includes("shipping:submit") ? "Shipping workspace" : permissions.includes("transactions:view") && !permissions.some((p) => p.endsWith(":submit") || p === "inventory:adjust") ? "Audit workspace" : "Warehouse workspace";
  const attention = data?.recent.filter((r) => r.status === "Failed" || r.status === "Requires Reconciliation") ?? [];
  const inProgress = (data?.counts["Processing"] ?? 0);
  const waiting = (data?.counts["Submitted"] ?? 0) + (data?.counts["Queued"] ?? 0);
  const needsCheck = (data?.counts["Failed"] ?? 0) + (data?.counts["Requires Reconciliation"] ?? 0);

  return (
    <>
      <PageHeader
        title="Control Tower"
        subtitle={<FreshnessLabel generatedAt={data?.generatedAt} maxAgeSeconds={data?.maxAgeSeconds} />}
        actions={<Button startIcon={<Refresh />} onClick={() => refetch()} disabled={isFetching}>Refresh</Button>}
      />
      {error && <ErrorNotice error={error} onRetry={() => refetch()} />}
      {isLoading && <LedgerSkeleton rows={4} />}
      {data && (
        <Stack spacing={4}>
          <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} justifyContent="space-between" sx={{ mb: 1.5 }}>
              <Box><Typography variant="h2" component="h2">{workspaceTitle}</Typography><Typography variant="body2" color="text.secondary">{roles.length ? `Business Central role${roles.length > 1 ? "s" : ""}: ${roles.join(", ")}. ` : ""}Available workspaces are derived from effective role permissions.</Typography></Box>
              <Typography variant="caption" color="text.secondary">{allowedWorkspaces.length} workspaces available</Typography>
            </Stack>
            <Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))", xl: "repeat(3,minmax(0,1fr))" } }}>
              {allowedWorkspaces.map((item) => <Paper key={item.href} component={Link} href={item.href} variant="outlined" sx={{ p: 1.5, display: "block", textDecoration: "none", color: "inherit", transition: "border-color .15s, background-color .15s", "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" }, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 } }}>
                <Stack direction="row" spacing={1} alignItems="center"><Typography fontWeight={700} sx={{ flexGrow: 1 }}>{item.title}</Typography><ArrowForward fontSize="small" /></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>{item.detail}</Typography>
              </Paper>)}
            </Box>
          </Paper>
          <Paper sx={{ p: { xs: 2, md: 3 } }}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "baseline" }} sx={{ mb: 2 }} spacing={0.5}>
              <Typography variant="h2" component="h2">Where work sits</Typography>
              <Typography variant="body2" color="text.secondary">
                {waiting} waiting, {inProgress} in progress, {needsCheck} need attention.{waitingText(data.oldestWaitingMs)}
              </Typography>
            </Stack>
            <QueueRibbon counts={data.counts} />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
              Based on the latest {data.sampleSize} transactions{data.sampleSize >= data.sampleLimit ? ` (limit ${data.sampleLimit})` : ""} in your warehouses.
            </Typography>
          </Paper>

          <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" } }}>
            <Box>
              <Typography variant="h2" component="h2" sx={{ mb: 1 }}>Needs attention</Typography>
              <Ledger rows={attention} empty="Nothing needs attention. Failed and unconfirmed transactions appear here." />
              {attention.length > 0 && <Button component={Link} href="/tasks" sx={{ mt: 1 }}>See all transactions</Button>}
              <Divider sx={{ my: 3 }} />
              <Typography variant="h2" component="h2" sx={{ mb: 1 }}>Latest activity</Typography>
              {data.recent.length === 0
                ? <EmptyState title="No activity yet" hint="Receive some stock and it will show up here." action={<Button component={Link} href="/inbound/receiving" variant="contained">Start a receipt</Button>} />
                : <Ledger rows={data.recent} empty="" />}
            </Box>
            <Box>
              <Typography variant="h2" component="h2" sx={{ mb: 1 }}>By operation</Typography>
              {Object.keys(data.byType).length === 0 ? (
                <Typography color="text.secondary">No operations to show.</Typography>
              ) : (
                <Box sx={{ height: 240 }} role="img" aria-label={`Transactions by operation: ${Object.entries(data.byType).map(([k, v]) => `${k} ${v}`).join(", ")}`}>
                  <ResponsiveContainer>
                    <BarChart data={Object.entries(data.byType).map(([name, value]) => ({ name, value }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 12 }} />
                      <Tooltip cursor={{ fillOpacity: 0.08 }} />
                      <Bar dataKey="value" name="Transactions" fill="#3B5B7A" radius={[0, 2, 2, 0]} barSize={22} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </Box>
          </Box>
        </Stack>
      )}
    </>
  );
}
