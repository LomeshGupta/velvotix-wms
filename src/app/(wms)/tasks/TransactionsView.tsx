"use client";
import Refresh from "@mui/icons-material/Refresh";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import dayjs from "dayjs";
import { useState } from "react";
import { EmptyState, ErrorNotice } from "@/components/feedback/Notices";
import { StatusChip } from "@/components/feedback/StatusChip";
import { PageHeader } from "@/components/layout/PageHeader";
import { useTransactions, type TransactionRow } from "@/hooks/useWms";
import { MONO } from "@/theme/theme";

const FILTERS = ["Submitted", "Queued", "Processing", "Completed", "Failed", "Requires Reconciliation", "Cancelled"];

const mono = (v?: string) => <span style={{ fontFamily: MONO }}>{v}</span>;

const columns: GridColDef<TransactionRow>[] = [
  { field: "requestedAt", headerName: "Requested", width: 168, valueFormatter: (v: string | undefined) => (v ? dayjs(v).format("D MMM, HH:mm:ss") : "") },
  { field: "operationType", headerName: "Operation", width: 130 },
  { field: "status", headerName: "Status", width: 170, renderCell: (p) => <StatusChip status={p.value as string} /> },
  { field: "locationCode", headerName: "From / Location", width: 130 },
  { field: "destinationLocationCode", headerName: "To location", width: 120 },
  { field: "sourceDocumentNo", headerName: "Source", width: 120, renderCell: (p) => mono(p.value as string) },
  { field: "resultDocumentNo", headerName: "Document", width: 130, renderCell: (p) => mono(p.value as string) },
  { field: "attemptCount", headerName: "Tries", width: 70, type: "number" },
  { field: "errorCode", headerName: "Reference", flex: 1, minWidth: 180, renderCell: (p) => mono(p.value as string) },
];

export function TransactionsView() {
  const [status, setStatus] = useState("");
  const { data, error, isLoading, isFetching, refetch } = useTransactions(status || undefined);
  const rows = data?.transactions ?? [];

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Everything submitted from this app, with the status Business Central reports. Showing the latest 100."
        actions={<Button startIcon={<Refresh />} onClick={() => refetch()} disabled={isFetching}>Refresh</Button>}
      />
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <FormControl sx={{ minWidth: 220 }}>
          <InputLabel id="status-filter">Status</InputLabel>
          <Select labelId="status-filter" label="Status" value={status} onChange={(e) => setStatus(String(e.target.value))}>
            <MenuItem value="">All statuses</MenuItem>
            {FILTERS.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>
      {error && <ErrorNotice error={error} onRetry={() => refetch()} />}
      {!error && (
        <div style={{ width: "100%" }}>
          <DataGrid
            rows={rows}
            columns={columns}
            loading={isLoading}
            density="compact"
            disableRowSelectionOnClick
            autoHeight
            pageSizeOptions={[25, 50, 100]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            slots={{ noRowsOverlay: () => <EmptyState title={status ? `No ${status.toLowerCase()} transactions` : "No transactions yet"} hint="Transactions you submit appear here with their live status." /> }}
            sx={{ bgcolor: "background.paper", "& .MuiDataGrid-cell": { display: "flex", alignItems: "center" } }}
          />
          {rows.length >= 100 && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Only the latest 100 are loaded. Use the status filter to narrow them.</Typography>}
        </div>
      )}
    </>
  );
}
