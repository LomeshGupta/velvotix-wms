"use client";
import Search from "@mui/icons-material/Search";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useEffect, useState } from "react";
import { EmptyState, ErrorNotice } from "@/components/feedback/Notices";
import { PageHeader } from "@/components/layout/PageHeader";
import { useItemSearch, type ItemHit } from "@/hooks/useWms";
import { MONO } from "@/theme/theme";

const columns: GridColDef<ItemHit & { id: string }>[] = [
  { field: "number", headerName: "Item", width: 140, renderCell: (p) => <span style={{ fontFamily: MONO }}>{p.value as string}</span> },
  { field: "displayName", headerName: "Description", flex: 1, minWidth: 220 },
  { field: "baseUnitOfMeasureCode", headerName: "Unit", width: 90 },
  { field: "gtin", headerName: "GTIN / Barcode", width: 160, renderCell: (p) => <span style={{ fontFamily: MONO }}>{(p.value as string) || "—"}</span> },
  { field: "inventory", headerName: "BC Inventory", width: 130, type: "number", align: "right", headerAlign: "right", valueFormatter: (v: number | undefined) => v === undefined ? "—" : new Intl.NumberFormat().format(v) },
];

/** Master-data lookup only. Stock quantities come from BC bin and ledger data and arrive with the inventory module. */
export function ItemsView() {
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  // Debounce so typing does not fire a Business Central read per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);
  const { data, error, isFetching, refetch } = useItemSearch(search);
  const rows = (data?.items ?? []).map((i) => ({ ...i, id: i.number }));

  return (
    <>
      <PageHeader title="Items & inventory lookup" subtitle="Search Business Central item master data by description. Inventory is the BC item-level quantity, not a bin-level available-to-promise calculation." />
      <TextField
        label="Search items"
        value={text}
        onChange={(e) => setText(e.target.value)}
        sx={{ mb: 2, width: { xs: "100%", sm: 360 } }}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }, htmlInput: { maxLength: 60 } }}
      />
      {error && <ErrorNotice error={error} onRetry={() => refetch()} />}
      {!error && (
        <DataGrid
          rows={rows}
          columns={columns}
          loading={isFetching}
          density="compact"
          autoHeight
          disableRowSelectionOnClick
          hideFooter={rows.length <= 25}
          slots={{ noRowsOverlay: () => <EmptyState title="No matching items" hint="Try part of the description, or scan the item in Receive." /> }}
          sx={{ bgcolor: "background.paper" }}
        />
      )}
    </>
  );
}
