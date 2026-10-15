"use client";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import dayjs from "dayjs";
import { ErrorNotice, LedgerSkeleton } from "@/components/feedback/Notices";
import { FreshnessLabel } from "@/components/feedback/FreshnessLabel";
import { PageHeader } from "@/components/layout/PageHeader";
import { useMonitor } from "@/hooks/useWms";

const ms = (n: number) => `${Math.round(n)} ms`;

function Fact({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  return (
    <Box sx={{ py: 1.25, borderTop: 1, borderColor: "divider", display: "flex", justifyContent: "space-between", gap: 2 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography sx={{ fontWeight: 600, color: tone === "bad" ? "error.main" : tone === "ok" ? "success.main" : "text.primary" }}>{value}</Typography>
    </Box>
  );
}

/** Per-instance view of the Business Central integration. Totals across several instances are not aggregated here. */
export function MonitorView() {
  const { data, error, isLoading, refetch } = useMonitor();
  const s = data?.scheduler;
  const ops = data ? Object.entries(data.metrics.operations).sort((a, b) => b[1].count - a[1].count) : [];
  const lastOk = data?.metrics.lastSuccessAt;

  return (
    <>
      <PageHeader title="Integration" subtitle={<FreshnessLabel generatedAt={data?.generatedAt} />} />
      {error && <ErrorNotice error={error} onRetry={() => refetch()} />}
      {isLoading && <LedgerSkeleton rows={4} />}
      {data && s && (
        <Stack spacing={4}>
          {data.mode === "mock" && <Alert severity="warning">Mock mode. Figures describe the simulated connection, not Business Central.</Alert>}
          {s.breaker !== "closed" && <Alert severity="error">Business Central requests are paused because of repeated failures. The system retries automatically.</Alert>}
          <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
            <Paper sx={{ p: 2.5 }}>
              <Typography variant="h2" component="h2" sx={{ mb: 1 }}>Connection</Typography>
              <Fact label="Environment" value={data.environment} />
              <Fact label="Last successful request" value={lastOk ? dayjs(lastOk).format("HH:mm:ss") : "None yet"} />
              <Fact label="Request gate" value={s.breaker === "closed" ? "Open" : s.breaker === "half-open" ? "Testing recovery" : "Paused"} tone={s.breaker === "closed" ? "ok" : "bad"} />
              <Fact label="Shared coordination" value={data.redis === "not configured" ? "Not configured (this instance only)" : data.redis === "up" ? "Redis connected" : "Redis down, using local limits"} tone={data.redis === "down" ? "bad" : undefined} />
              <Fact label="Failed sign-ins" value={String(data.metrics.authFailures)} />
            </Paper>
            <Paper sx={{ p: 2.5 }}>
              <Typography variant="h2" component="h2" sx={{ mb: 1 }}>Queue</Typography>
              <Fact label="Waiting: interactive / writes / background" value={`${s.queued.interactive} / ${s.queued.write} / ${s.queued.background}`} />
              <Fact label="Running: interactive / writes / background" value={`${s.active.interactive} / ${s.active.write} / ${s.active.background}`} />
              <Fact label="Oldest waiting request" value={s.oldestQueuedMs > 0 ? `${(s.oldestQueuedMs / 1000).toFixed(1)} s` : "None"} />
              <Fact label="Concurrency budget (all instances)" value={`${data.limits.maxConcurrent} total, ${data.limits.ratePerSecond} per second`} />
              <Fact label="Instances configured" value={String(data.limits.instanceCount)} />
            </Paper>
          </Box>

          <Box>
            <Typography variant="h2" component="h2" sx={{ mb: 1 }}>Requests by operation</Typography>
            {ops.length === 0 ? <Typography color="text.secondary">No Business Central requests have been made by this instance yet.</Typography> : (
              <TableContainer component={Paper}>
                <Table size="small" aria-label="Requests by operation">
                  <TableHead>
                    <TableRow>
                      <TableCell>Operation</TableCell><TableCell align="right">Calls</TableCell><TableCell align="right">Errors</TableCell><TableCell align="right">Throttled</TableCell>
                      <TableCell align="right">Cache hits</TableCell><TableCell align="right">Shared</TableCell><TableCell align="right">p50</TableCell><TableCell align="right">p95</TableCell><TableCell align="right">p99</TableCell><TableCell align="right">Queue wait p95</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {ops.map(([name, o]) => (
                      <TableRow key={name} hover>
                        <TableCell sx={{ fontWeight: 600 }}>{name}</TableCell>
                        <TableCell align="right">{o.count}</TableCell>
                        <TableCell align="right">{o.errors > 0 ? <Chip size="small" color="error" label={o.errors} /> : 0}</TableCell>
                        <TableCell align="right">{o.throttled}</TableCell>
                        <TableCell align="right">{o.cacheHits}</TableCell>
                        <TableCell align="right">{o.deduped}</TableCell>
                        <TableCell align="right">{ms(o.p50)}</TableCell><TableCell align="right">{ms(o.p95)}</TableCell><TableCell align="right">{ms(o.p99)}</TableCell><TableCell align="right">{ms(o.queueWaitP95)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        </Stack>
      )}
    </>
  );
}
