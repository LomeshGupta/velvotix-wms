"use client";
import Add from "@mui/icons-material/Add";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import Remove from "@mui/icons-material/Remove";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { ErrorNotice } from "@/components/feedback/Notices";
import { PageHeader } from "@/components/layout/PageHeader";
import { useOnline } from "@/components/layout/NetworkStatus";
import { ScanInput } from "@/components/scanning/ScanInput";
import { TransactionTimeline } from "@/components/transactions/TransactionTimeline";
import { friendlyMessage } from "@/lib/api-client";
import { isTerminal, useItemLookup, useSubmitReceipt, useTransaction } from "@/hooks/useWms";
import { useDraftStore, useSessionStore, type DraftLine } from "@/store/uiStore";
import { MONO } from "@/theme/theme";

export function ReceivingView() {
  const online = useOnline();
  const { userId, selectedLocation } = useSessionStore();
  const { draft, update, reset } = useDraftStore();
  const lookup = useItemLookup();
  const submit = useSubmitReceipt();
  const scanRef = useRef<HTMLInputElement>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const init = () => ({ clientKey: crypto.randomUUID(), locationCode: selectedLocation ?? "", sourceDocumentNo: "", lines: [] as DraftLine[], transactionId: null as string | null, userId: userId ?? "" });

  // A draft left behind by another person on a shared device must never carry over.
  useEffect(() => {
    if (draft && userId && draft.userId && draft.userId !== userId) reset();
  }, [draft, userId, reset]);

  const lines = draft?.lines ?? [];
  const transactionId = draft?.transactionId ?? null;
  const tracking = useTransaction(transactionId);
  const tx = tracking.data?.transaction;
  const locked = Boolean(transactionId);
  const location = draft?.locationCode || selectedLocation || "";
  const locationMismatch = Boolean(draft && draft.lines.length > 0 && selectedLocation && draft.locationCode !== selectedLocation);

  // Warn before leaving with scanned work that has not been submitted.
  useEffect(() => {
    if (lines.length === 0 || locked) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [lines.length, locked]);

  const setLines = (fn: (l: DraftLine[]) => DraftLine[]) => update((d) => ({ ...d, userId: userId ?? d.userId, locationCode: d.lines.length === 0 ? selectedLocation ?? d.locationCode : d.locationCode, lines: fn(d.lines) }), init);

  const onScan = async (code: string) => {
    setScanError(null);
    try {
      const { item } = await lookup.mutateAsync(code);
      if (item.blocked) { setScanError(`Item ${item.number} is blocked and cannot be received.`); return; }
      setLines((ls) => {
        const i = ls.findIndex((l) => l.itemNo === item.number && !l.lotNo);
        if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, quantity: l.quantity + 1 } : l));
        return [...ls, { itemNo: item.number, description: item.displayName, unitOfMeasureCode: item.baseUnitOfMeasureCode, quantity: 1, lotNo: "" }];
      });
      setAnnounce(`${item.displayName} added`);
    } catch (e) {
      setScanError(friendlyMessage(e));
    } finally {
      scanRef.current?.focus();
    }
  };

  const patchLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const invalid = lines.some((l) => !Number.isFinite(l.quantity) || l.quantity <= 0);
  const canSubmit = lines.length > 0 && !invalid && !locked && online && Boolean(location) && !locationMismatch;
  const total = lines.reduce((n, l) => n + (Number.isFinite(l.quantity) ? l.quantity : 0), 0);

  const doSubmit = async () => {
    if (!draft) return;
    setConfirmOpen(false);
    try {
      const r = await submit.mutateAsync({
        clientKey: draft.clientKey,
        locationCode: draft.locationCode,
        sourceDocumentNo: draft.sourceDocumentNo.trim() || undefined,
        lines: draft.lines.map((l) => ({ itemNo: l.itemNo, quantity: l.quantity, unitOfMeasureCode: l.unitOfMeasureCode || undefined, lotNo: l.lotNo.trim() || undefined })),
      });
      update((d) => ({ ...d, transactionId: r.transactionId }), init);
    } catch {
      /* surfaced through submit.error; the draft and its key are kept so a retry is the same submission */
    }
  };

  const startNew = () => { reset(); submit.reset(); setScanError(null); setTimeout(() => scanRef.current?.focus(), 0); };
  const done = tx ? isTerminal(tx.status) : false;

  return (
    <>
      <PageHeader title="Receive stock" subtitle={location ? <>Receiving into <strong>{location}</strong></> : "No warehouse assigned to your user"} />

      {!location && <Alert severity="warning">Your user is not assigned to a warehouse. Ask an administrator to assign one.</Alert>}
      {!online && <Alert severity="warning" sx={{ mb: 2 }}>You are offline. You can keep scanning, but you cannot submit until the connection is back. Scanned lines stay on this device until you reload or close the tab.</Alert>}
      {locationMismatch && <Alert severity="info" sx={{ mb: 2 }}>This receipt is for {draft?.locationCode}. Submit or clear it before receiving into {selectedLocation}.</Alert>}

      <Stack spacing={3} sx={{ maxWidth: 760 }}>
        {!locked && (
          <>
            <TextField
              label="Purchase order (optional)"
              value={draft?.sourceDocumentNo ?? ""}
              onChange={(e) => update((d) => ({ ...d, sourceDocumentNo: e.target.value.toUpperCase() }), init)}
              slotProps={{ htmlInput: { style: { fontFamily: MONO }, maxLength: 20 } }}
              sx={{ maxWidth: 280 }}
            />
            <ScanInput ref={scanRef} onScan={onScan} busy={lookup.isPending} disabled={!location} error={Boolean(scanError)} helperText={scanError ?? "Scan a barcode or type an item number, then press Enter."} />
          </>
        )}
        <Box role="status" aria-live="polite" sx={{ position: "absolute", left: -9999 }}>{announce}</Box>

        <Box>
          <Typography variant="h2" component="h2" sx={{ mb: 1 }}>{locked ? "Submitted lines" : `Scanned lines${lines.length ? ` (${lines.length})` : ""}`}</Typography>
          {lines.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3 }}>Nothing scanned yet. Scan the first item to start the receipt.</Typography>
          ) : (
            <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
              {lines.map((l, i) => (
                <Box
                  component="li"
                  key={`${l.itemNo}-${i}`}
                  sx={{
                    display: "grid", gap: 1.5, alignItems: "center", py: 1.5, borderTop: 1, borderColor: "divider",
                    gridTemplateColumns: { xs: "1fr auto", sm: "1fr 150px 140px 40px" },
                    gridTemplateAreas: { xs: '"info remove" "qty lot"', sm: '"info qty lot remove"' },
                  }}
                >
                  <Box sx={{ gridArea: "info", minWidth: 0 }}>
                    <Typography sx={{ fontFamily: MONO, fontWeight: 500 }}>{l.itemNo}</Typography>
                    <Typography variant="body2" color="text.secondary">{l.description} · {l.unitOfMeasureCode}</Typography>
                  </Box>
                  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ gridArea: "qty" }}>
                    <IconButton size="small" aria-label={`Decrease ${l.itemNo}`} disabled={locked || l.quantity <= 1} onClick={() => patchLine(i, { quantity: Math.max(1, l.quantity - 1) })}><Remove /></IconButton>
                    <TextField
                      value={Number.isFinite(l.quantity) ? l.quantity : ""}
                      onChange={(e) => patchLine(i, { quantity: e.target.value === "" ? NaN : Number(e.target.value) })}
                      disabled={locked}
                      error={!Number.isFinite(l.quantity) || l.quantity <= 0}
                      slotProps={{ htmlInput: { inputMode: "decimal", "aria-label": `Quantity for ${l.itemNo}`, style: { textAlign: "center", fontVariantNumeric: "tabular-nums", minWidth: 40 } } }}
                    />
                    <IconButton size="small" aria-label={`Increase ${l.itemNo}`} disabled={locked} onClick={() => patchLine(i, { quantity: (Number.isFinite(l.quantity) ? l.quantity : 0) + 1 })}><Add /></IconButton>
                  </Stack>
                  <TextField sx={{ gridArea: "lot" }} label="Lot" value={l.lotNo} disabled={locked} onChange={(e) => patchLine(i, { lotNo: e.target.value.toUpperCase() })} slotProps={{ htmlInput: { maxLength: 50, style: { fontFamily: MONO } } }} />
                  {!locked && <IconButton sx={{ gridArea: "remove", alignSelf: { xs: "start", sm: "center" } }} aria-label={`Remove ${l.itemNo}`} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}><DeleteOutline /></IconButton>}
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {submit.error && !locked && (
          <ErrorNotice error={submit.error} />
        )}

        {locked && (
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h2" component="h2" sx={{ mb: 1 }}>Status</Typography>
            {tracking.error && !tx ? <ErrorNotice error={tracking.error} onRetry={() => tracking.refetch()} /> : (
              <TransactionTimeline tx={tx ?? { status: "Submitted" }} noun="Receipt" />
            )}
            {done && <Button sx={{ mt: 2 }} variant={tx?.status === "Completed" ? "contained" : "outlined"} onClick={startNew}>Start a new receipt</Button>}
          </Paper>
        )}

        {!locked && (
          <Box sx={{ position: "sticky", bottom: { xs: "calc(72px + env(safe-area-inset-bottom, 0px))", md: 16 }, zIndex: 5 }}>
            <Paper sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 2, boxShadow: 3 }}>
              <Typography variant="body2" sx={{ flexGrow: 1 }}>{lines.length === 0 ? "No lines yet" : `${lines.length} ${lines.length === 1 ? "line" : "lines"}, ${total} ${total === 1 ? "unit" : "units"}`}</Typography>
              {lines.length > 0 && <Button onClick={startNew}>Clear</Button>}
              <Button variant="contained" size="large" sx={{ whiteSpace: "nowrap", flexShrink: 0 }} disabled={!canSubmit || submit.isPending} onClick={() => setConfirmOpen(true)}>
                {submit.isPending ? "Submitting" : submit.error ? "Check and submit again" : "Submit receipt"}
              </Button>
            </Paper>
          </Box>
        )}
      </Stack>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Submit this receipt?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {lines.length} {lines.length === 1 ? "line" : "lines"}, {total} {total === 1 ? "unit" : "units"} into {location}{draft?.sourceDocumentNo ? `, purchase order ${draft.sourceDocumentNo}` : ""}. It is saved in Business Central first and counts as received only when the status shows completed.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Keep editing</Button>
          <Button variant="contained" onClick={doSubmit} autoFocus>Submit receipt</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
