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
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";
import { ErrorNotice } from "@/components/feedback/Notices";
import { PageHeader } from "@/components/layout/PageHeader";
import { useOnline } from "@/components/layout/NetworkStatus";
import { ScanInput } from "@/components/scanning/ScanInput";
import { TransactionTimeline } from "@/components/transactions/TransactionTimeline";
import { friendlyMessage } from "@/lib/api-client";
import { isTerminal, useItemLookup, useSubmitOperation, useTransaction, useWarehouseShipmentLines, useWarehouseShipments, type WmsOperationPayload, type WmsOperationType } from "@/hooks/useWms";
import { useSessionStore } from "@/store/uiStore";
import { MONO } from "@/theme/theme";

export interface WorkbenchConfig {
  operationType: WmsOperationType;
  permission: string;
  title: string;
  subtitle: string;
  sourceDocumentLabel: string;
  sourceDocumentType: string;
  sourceDocumentRequired?: boolean;
  selectWarehouseShipment?: boolean;
  showBins?: boolean;
  requireFromBin?: boolean;
  requireToBin?: boolean;
  allowDestinationWarehouse?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonOptions?: readonly { value: string; label: string }[];
  submitLabel: string;
  lineHeading: string;
}

interface WorkLine {
  itemNo: string;
  description: string;
  unitOfMeasureCode: string;
  quantity: number;
  /** Target quantity from the BC warehouse shipment; actual scan count is quantity. */
  expectedQuantity?: number;
  /** Base Warehouse Shipment Line."Line No." used for later AL-side document validation. */
  sourceLineNo?: number;
  fromBinCode: string;
  toBinCode: string;
  lotNo: string;
  serialNo: string;
}

type ScanTarget = "item" | "fromBin" | "toBin" | "lot" | "serial";
const emptyLine = (): WorkLine => ({ itemNo: "", description: "", unitOfMeasureCode: "", quantity: 1, fromBinCode: "", toBinCode: "", lotNo: "", serialNo: "" });

/**
 * Reusable, role-gated warehouse workbench. It creates a durable BC staging transaction; it never
 * tells an operator the base BC document was posted until the queue reports Completed.
 */
export function OperationWorkbenchView({ config }: { config: WorkbenchConfig }) {
  const online = useOnline();
  const { selectedLocation, warehouseCodes } = useSessionStore();
  const lookup = useItemLookup();
  const submit = useSubmitOperation();
  const [sourceDocumentNo, setSourceDocumentNo] = useState("");
  const [loadedShipmentKey, setLoadedShipmentKey] = useState("");
  const [destinationLocationCode, setDestinationLocationCode] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [lines, setLines] = useState<WorkLine[]>([]);
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const [scanTarget, setScanTarget] = useState<ScanTarget>("item");
  const [scanError, setScanError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID());
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const txQuery = useTransaction(transactionId);
  const tx = txQuery.data?.transaction;
  const locked = Boolean(transactionId);
  const locationCode = selectedLocation ?? "";
  const shipmentQuery = useWarehouseShipments(config.selectWarehouseShipment ? locationCode : "");
  const shipmentLinesQuery = useWarehouseShipmentLines(locationCode, sourceDocumentNo, Boolean(config.selectWarehouseShipment));
  const destinationChoices = useMemo(() => warehouseCodes.filter((code) => code.toUpperCase() !== locationCode.toUpperCase()), [warehouseCodes, locationCode]);

  useEffect(() => {
    const key = `${locationCode}:${sourceDocumentNo}`;
    if (!config.selectWarehouseShipment || !sourceDocumentNo || shipmentLinesQuery.isLoading || shipmentLinesQuery.isError || !shipmentLinesQuery.data || loadedShipmentKey === key) return;
    const planned = shipmentLinesQuery.data.lines
      .filter((line) => Number(line.qtyToShip) > 0)
      .map((line) => ({
        ...emptyLine(), itemNo: line.itemNo, description: line.description,
        unitOfMeasureCode: line.unitOfMeasureCode, quantity: 0,
        expectedQuantity: Number(line.qtyToShip), sourceLineNo: Number(line.lineNo),
        fromBinCode: line.binCode ?? "",
      }));
    setLines(planned);
    setActiveLineIndex(planned.length ? 0 : -1);
    setLoadedShipmentKey(key);
  }, [config.selectWarehouseShipment, locationCode, sourceDocumentNo, shipmentLinesQuery.data, shipmentLinesQuery.isError, shipmentLinesQuery.isLoading, loadedShipmentKey]);

  const updateLine = (index: number, patch: Partial<WorkLine>) => setLines((old) => old.map((line, i) => i === index ? { ...line, ...patch } : line));

  const onScan = async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code || locked) return;
    setScanError(null);
    if (scanTarget !== "item") {
      if (lines.length === 0) { setScanError("Scan an item first, then choose the line to update."); return; }
      const index = activeLineIndex >= 0 && activeLineIndex < lines.length ? activeLineIndex : lines.length - 1;
      const patch: Partial<WorkLine> = scanTarget === "fromBin" ? { fromBinCode: code.toUpperCase() }
        : scanTarget === "toBin" ? { toBinCode: code.toUpperCase() }
          : scanTarget === "lot" ? { lotNo: code.toUpperCase() } : { serialNo: code.toUpperCase() };
      updateLine(index, patch);
      setAnnounce(`${scanTarget} scanned for ${lines[index]?.itemNo ?? "line"}`);
      return;
    }
    try {
      const { item } = await lookup.mutateAsync(code);
      if (item.blocked) { setScanError(`Item ${item.number} is blocked and cannot be used for this operation.`); return; }
      if (config.selectWarehouseShipment) {
        const found = lines.findIndex((line) => line.itemNo.toUpperCase() === item.number.toUpperCase() && line.expectedQuantity !== undefined && line.quantity < line.expectedQuantity && !line.serialNo);
        if (found < 0) {
          setScanError(`Item ${item.number} is not on the selected shipment, or its required quantity has already been scanned.`);
          return;
        }
        setActiveLineIndex(found);
        setLines((old) => old.map((line, i) => i === found ? { ...line, quantity: line.quantity + 1 } : line));
        setAnnounce(`${item.displayName}: ${lines[found]!.quantity + 1} of ${lines[found]!.expectedQuantity} scanned`);
        return;
      }
      const found = lines.findIndex((l) => l.itemNo.toUpperCase() === item.number.toUpperCase() && !l.serialNo);
      if (found >= 0) {
        setActiveLineIndex(found);
        setLines((old) => old.map((l, i) => i === found ? { ...l, quantity: l.quantity + 1 } : l));
      } else {
        setActiveLineIndex(lines.length);
        setLines((old) => [...old, { ...emptyLine(), itemNo: item.number, description: item.displayName, unitOfMeasureCode: item.baseUnitOfMeasureCode }]);
      }
      setAnnounce(`${item.displayName} added to ${config.operationType}`);
    } catch (e) {
      setScanError(friendlyMessage(e));
    }
  };

  const totalQuantity = lines.reduce((sum, line) => sum + (Number.isFinite(line.quantity) ? line.quantity : 0), 0);
  const invalidLines = lines.some((line) => !line.itemNo || !Number.isFinite(line.quantity) || line.quantity <= 0 || (line.expectedQuantity !== undefined && line.quantity !== line.expectedQuantity) || (config.requireFromBin && !line.fromBinCode.trim()) || (config.requireToBin && !line.toBinCode.trim()));
  const missingDocument = Boolean(config.sourceDocumentRequired && !sourceDocumentNo.trim());
  const missingReason = Boolean(config.requireReason && !reasonCode.trim());
  const canSubmit = Boolean(locationCode) && lines.length > 0 && !invalidLines && !missingDocument && !missingReason && !locked && online && !lookup.isPending;

  const doSubmit = async () => {
    setConfirmOpen(false);
    const payload: WmsOperationPayload = {
      clientKey,
      operationType: config.operationType,
      locationCode,
      destinationLocationCode: destinationLocationCode || undefined,
      sourceDocumentType: config.sourceDocumentType,
      sourceDocumentNo: sourceDocumentNo.trim() || undefined,
      reasonCode: reasonCode.trim() || undefined,
      lines: lines.map((line) => ({
        itemNo: line.itemNo,
        quantity: line.quantity,
        unitOfMeasureCode: line.unitOfMeasureCode || undefined,
        fromBinCode: line.fromBinCode.trim() || undefined,
        toBinCode: line.toBinCode.trim() || undefined,
        lotNo: line.lotNo.trim() || undefined,
        serialNo: line.serialNo.trim() || undefined,
        reasonCode: reasonCode.trim() || undefined,
        sourceLineNo: line.sourceLineNo,
      })),
    };
    try {
      const result = await submit.mutateAsync(payload);
      setTransactionId(result.transactionId);
    } catch {
      // Keep the same clientKey and draft so a retry reconciles with the same BC transaction.
    }
  };

  const startNew = () => {
    setSourceDocumentNo(""); setLoadedShipmentKey(""); setDestinationLocationCode(""); setReasonCode(""); setLines([]);
    setActiveLineIndex(-1); setScanTarget("item"); setScanError(null); setTransactionId(null); setClientKey(crypto.randomUUID()); submit.reset();
  };

  return (
    <>
      <PageHeader title={config.title} subtitle={locationCode ? <>{config.subtitle} · Warehouse <strong>{locationCode}</strong></> : "No warehouse assigned to your user"} />
      {!locationCode && <Alert severity="warning" sx={{ mb: 2 }}>Your Business Central WMS user has no warehouse assignment. Ask your BC administrator to assign a location.</Alert>}
      {!online && <Alert severity="warning" sx={{ mb: 2 }}>You are offline. Camera and hardware scanning remain available, but submission is blocked until connectivity returns.</Alert>}
      {config.sourceDocumentRequired && <Alert severity="info" sx={{ mb: 2 }}>This workbench stages a {config.operationType.toLowerCase()} request against a Business Central source document. The source document number is validated by the live AL handler, not just by this screen.</Alert>}

      <Stack spacing={2.5} sx={{ maxWidth: 1000 }}>
        {!locked && (
          <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
            <Typography variant="h2" component="h2" sx={{ mb: 2 }}>Work order details</Typography>
            <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: config.allowDestinationWarehouse ? "repeat(3,minmax(0,1fr))" : "repeat(2,minmax(0,1fr))" } }}>
              {config.selectWarehouseShipment ? <FormControl fullWidth required={config.sourceDocumentRequired}>
                <InputLabel id="source-warehouse-shipment-label">{config.sourceDocumentLabel}</InputLabel>
                <Select labelId="source-warehouse-shipment-label" label={config.sourceDocumentLabel} value={sourceDocumentNo} onChange={(e) => { setSourceDocumentNo(String(e.target.value)); setLoadedShipmentKey(""); setLines([]); setActiveLineIndex(-1); }}>
                  <MenuItem value="">Select a released shipment</MenuItem>
                  {(shipmentQuery.data?.shipments ?? []).map((shipment) => <MenuItem key={shipment.id} value={shipment.number}>{shipment.number} · {shipment.documentStatus?.trim() || "Not picked"}{shipment.externalDocumentNo ? ` · ${shipment.externalDocumentNo}` : ""}</MenuItem>)}
                </Select>
                {shipmentQuery.isLoading && <Typography variant="caption" color="text.secondary">Loading released Business Central shipments…</Typography>}
                {shipmentQuery.isError && <Typography variant="caption" color="error">Unable to load shipment queue. Check BC API publication and warehouse access.</Typography>}
                {!shipmentQuery.isLoading && !shipmentQuery.isError && (shipmentQuery.data?.shipments.length ?? 0) === 0 && <Typography variant="caption" color="text.secondary">No released warehouse shipments were found for {locationCode}.</Typography>}
              </FormControl> : <TextField label={config.sourceDocumentLabel} value={sourceDocumentNo} onChange={(e) => setSourceDocumentNo(e.target.value.toUpperCase())} required={config.sourceDocumentRequired} slotProps={{ htmlInput: { maxLength: 20, style: { fontFamily: MONO } } }} />}
              {config.allowDestinationWarehouse && <FormControl fullWidth>
                <InputLabel id="destination-location-label">Destination warehouse</InputLabel>
                <Select labelId="destination-location-label" label="Destination warehouse" value={destinationLocationCode} onChange={(e) => setDestinationLocationCode(String(e.target.value))}>
                  <MenuItem value="">Same warehouse</MenuItem>
                  {destinationChoices.map((code) => <MenuItem key={code} value={code}>{code}</MenuItem>)}
                </Select>
              </FormControl>}
              
              {(config.requireReason || config.reasonOptions) && (config.reasonOptions ? <FormControl fullWidth required={config.requireReason}>
                <InputLabel id="reason-code-label">{config.reasonLabel ?? "Reason"}</InputLabel>
                <Select labelId="reason-code-label" label={config.reasonLabel ?? "Reason"} value={reasonCode} onChange={(e) => setReasonCode(String(e.target.value))}>
                  {config.reasonOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                </Select>
              </FormControl> : <TextField label={config.reasonLabel ?? "Reason code"} value={reasonCode} onChange={(e) => setReasonCode(e.target.value.toUpperCase())} required={config.requireReason} slotProps={{ htmlInput: { maxLength: 20, style: { fontFamily: MONO } } }} />)}
            </Box>
            {config.selectWarehouseShipment && sourceDocumentNo && <Box sx={{ mt: 2, borderTop: 1, borderColor: "divider", pt: 2 }}>
              <Typography variant="h3" component="h3" sx={{ mb: 1 }}>Business Central shipment lines</Typography>
              {shipmentLinesQuery.isLoading && <Typography variant="body2" color="text.secondary">Loading base warehouse shipment lines…</Typography>}
              {shipmentLinesQuery.isError && <Alert severity="error">Unable to read lines for {sourceDocumentNo}. Verify the WMS warehouse shipment line API page is published and the integration permission set is assigned.</Alert>}
              {!shipmentLinesQuery.isLoading && !shipmentLinesQuery.isError && (shipmentLinesQuery.data?.lines.length ?? 0) === 0 && <Typography variant="body2" color="text.secondary">No lines found on this warehouse shipment.</Typography>}
              {(shipmentLinesQuery.data?.lines ?? []).map((line) => <Box key={line.id} sx={{ py: 1, borderBottom: 1, borderColor: "divider", display: "grid", gridTemplateColumns: { xs: "1fr auto", sm: "minmax(0,1fr) auto auto auto" }, gap: 1, alignItems: "center" }}>
                <Box sx={{ minWidth: 0 }}><Typography fontWeight={600}>{line.itemNo} · {line.description}</Typography><Typography variant="caption" color="text.secondary">Line {line.lineNo}{line.binCode ? ` · Bin ${line.binCode}` : ""}{line.sourceNo ? ` · Source ${line.sourceNo}` : ""}</Typography></Box>
                <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>To ship: {line.qtyToShip}</Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>Picked: {line.qtyPicked}</Typography>
                <Typography variant="caption" color="text.secondary">{line.status?.trim() || "Open"}</Typography>
              </Box>)}
            </Box>}
          </Paper>
        )}

        {!locked && <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
          <Typography variant="h2" component="h2" sx={{ mb: 1.5 }}>Scan work</Typography>
          <Stack spacing={1.5}>
            <FormControl size="small" sx={{ maxWidth: 320 }}>
              <InputLabel id="scan-target-label">Camera / scanner target</InputLabel>
              <Select labelId="scan-target-label" label="Camera / scanner target" value={scanTarget} onChange={(e) => setScanTarget(e.target.value as ScanTarget)}>
                <MenuItem value="item">Item / GTIN barcode</MenuItem>
                {config.showBins && <MenuItem value="fromBin">Source bin barcode</MenuItem>}
                {config.showBins && <MenuItem value="toBin">Destination bin barcode</MenuItem>}
                <MenuItem value="lot">Lot number barcode</MenuItem>
                <MenuItem value="serial">Serial number barcode</MenuItem>
              </Select>
            </FormControl>
            <ScanInput onScan={onScan} busy={lookup.isPending || submit.isPending} disabled={!locationCode || locked || Boolean(config.selectWarehouseShipment && (!sourceDocumentNo || shipmentLinesQuery.isLoading || shipmentLinesQuery.isError || !shipmentLinesQuery.data))} label={scanTarget === "item" ? "Scan item / GTIN" : `Scan ${scanTarget === "fromBin" ? "source bin" : scanTarget === "toBin" ? "destination bin" : scanTarget === "lot" ? "lot number" : "serial number"}`} helperText={scanError ?? "Use the camera, a Bluetooth/USB scanner, or type a value and press Enter."} error={Boolean(scanError)} />
            <Box role="status" aria-live="polite" sx={{ position: "absolute", left: -9999 }}>{announce}</Box>
          </Stack>
        </Paper>}

        <Box>
          <Typography variant="h2" component="h2" sx={{ mb: 1.5 }}>{config.lineHeading}{lines.length ? ` (${lines.length})` : ""}</Typography>
          {lines.length === 0 ? <Alert severity="info">Scan the first item to start this {config.operationType.toLowerCase()} task. Repeated item scans increment quantity unless a serial number is already present.</Alert> : <Stack spacing={1.5}>
            {lines.map((line, i) => <Paper key={`${line.itemNo}-${i}`} variant="outlined" sx={{ p: 1.5, borderColor: activeLineIndex === i ? "secondary.main" : "divider", borderLeftWidth: activeLineIndex === i ? 4 : 1 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Button variant="text" onClick={() => setActiveLineIndex(i)} sx={{ p: 0, minWidth: 0, fontFamily: MONO, fontWeight: 700 }}>{line.itemNo}</Button>
                  <Typography variant="body2" color="text.secondary">{line.description || "Item description unavailable"} · {line.unitOfMeasureCode || "Unit not set"}</Typography>
                </Box>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <IconButton size="small" aria-label={`Decrease ${line.itemNo}`} disabled={locked || line.quantity <= (line.expectedQuantity !== undefined ? 0 : 1)} onClick={() => updateLine(i, { quantity: Math.max(line.expectedQuantity !== undefined ? 0 : 1, line.quantity - 1) })}><Remove /></IconButton>
                  <TextField value={Number.isFinite(line.quantity) ? line.quantity : ""} onChange={(e) => updateLine(i, { quantity: e.target.value === "" ? NaN : Number(e.target.value) })} disabled={locked} error={!Number.isFinite(line.quantity) || line.quantity <= 0 || (line.expectedQuantity !== undefined && line.quantity !== line.expectedQuantity && line.quantity > line.expectedQuantity)} label={line.expectedQuantity !== undefined ? `Scanned / ${line.expectedQuantity}` : "Qty"} size="small" sx={{ width: 132 }} slotProps={{ htmlInput: { inputMode: "decimal", "aria-label": `Quantity for ${line.itemNo}` } }} />
                  <IconButton size="small" aria-label={`Increase ${line.itemNo}`} disabled={locked || (line.expectedQuantity !== undefined && line.quantity >= line.expectedQuantity)} onClick={() => updateLine(i, { quantity: line.quantity + 1 })}><Add /></IconButton>
                  <IconButton size="small" aria-label={`Remove ${line.itemNo}`} disabled={locked || line.expectedQuantity !== undefined} onClick={() => { setLines((old) => old.filter((_, k) => k !== i)); setActiveLineIndex((active) => active === i ? -1 : active > i ? active - 1 : active); }}><DeleteOutline /></IconButton>
                </Stack>
              </Stack>
              <Box sx={{ display: "grid", gap: 1, mt: 1.5, gridTemplateColumns: { xs: "1fr 1fr", md: config.showBins ? "repeat(4,minmax(0,1fr))" : "repeat(2,minmax(0,1fr))" } }}>
                {config.showBins && <TextField size="small" label="From bin" value={line.fromBinCode} disabled={locked} onFocus={() => { setActiveLineIndex(i); setScanTarget("fromBin"); }} onChange={(e) => updateLine(i, { fromBinCode: e.target.value.toUpperCase() })} error={Boolean(config.requireFromBin && !line.fromBinCode.trim())} slotProps={{ htmlInput: { maxLength: 20, style: { fontFamily: MONO } } }} />}
                {config.showBins && <TextField size="small" label="To bin" value={line.toBinCode} disabled={locked} onFocus={() => { setActiveLineIndex(i); setScanTarget("toBin"); }} onChange={(e) => updateLine(i, { toBinCode: e.target.value.toUpperCase() })} error={Boolean(config.requireToBin && !line.toBinCode.trim())} slotProps={{ htmlInput: { maxLength: 20, style: { fontFamily: MONO } } }} />}
                <TextField size="small" label="Lot no." value={line.lotNo} disabled={locked} onFocus={() => { setActiveLineIndex(i); setScanTarget("lot"); }} onChange={(e) => updateLine(i, { lotNo: e.target.value.toUpperCase() })} slotProps={{ htmlInput: { maxLength: 50, style: { fontFamily: MONO } } }} />
                <TextField size="small" label="Serial no." value={line.serialNo} disabled={locked} onFocus={() => { setActiveLineIndex(i); setScanTarget("serial"); }} onChange={(e) => updateLine(i, { serialNo: e.target.value.toUpperCase() })} slotProps={{ htmlInput: { maxLength: 50, style: { fontFamily: MONO } } }} />
              </Box>
            </Paper>)}
          </Stack>}
        </Box>

        {submit.error && !locked && <ErrorNotice error={submit.error} />}
        {locked && <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h2" component="h2" sx={{ mb: 1 }}>Business Central processing status</Typography>
          {txQuery.error && !tx ? <ErrorNotice error={txQuery.error} onRetry={() => txQuery.refetch()} /> : <TransactionTimeline tx={tx ?? { status: "Submitted" }} noun={config.operationType} />}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Accepted means saved to the Business Central WMS staging queue. Stock, documents and ledger entries change only when an installed live AL handler processes the transaction successfully.</Typography>
          {tx && isTerminal(tx.status) && <Button sx={{ mt: 2 }} variant="contained" onClick={startNew}>Start next task</Button>}
        </Paper>}

        {!locked && <Box sx={{ position: "sticky", bottom: { xs: "calc(72px + env(safe-area-inset-bottom, 0px))", md: 16 }, zIndex: 5 }}>
          <Paper sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1.5, boxShadow: 3 }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}><Typography variant="body2" fontWeight={600}>{lines.length ? `${lines.length} lines · ${totalQuantity} units` : "No lines yet"}</Typography><Typography variant="caption" color="text.secondary">{lines.length && invalidLines ? (config.selectWarehouseShipment ? "Scan the required shipment quantity for each line" : "Complete required bins and valid quantities") : config.requireReason && !reasonCode.trim() ? "Choose a reason before submitting" : "Saved to BC staging after submission"}</Typography></Box>
            {lines.length > 0 && <Button onClick={startNew}>Clear</Button>}
            <Button variant="contained" size="large" disabled={!canSubmit || submit.isPending} onClick={() => setConfirmOpen(true)} sx={{ whiteSpace: "nowrap", flexShrink: 0 }}>{submit.isPending ? "Submitting…" : submit.error ? "Retry same task" : config.submitLabel}</Button>
          </Paper>
        </Box>}
      </Stack>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Submit {config.operationType.toLowerCase()} task?</DialogTitle>
        <DialogContent><DialogContentText>{lines.length} {lines.length === 1 ? "line" : "lines"}, {totalQuantity} units at {locationCode}{destinationLocationCode ? ` to ${destinationLocationCode}` : ""}{sourceDocumentNo ? ` · ${config.sourceDocumentLabel}: ${sourceDocumentNo}` : ""}. This request will be staged in Business Central and must be validated/processed by the installed AL operation handler.</DialogContentText></DialogContent>
        <DialogActions><Button onClick={() => setConfirmOpen(false)}>Keep editing</Button><Button variant="contained" onClick={() => void doSubmit()} autoFocus>Submit task</Button></DialogActions>
      </Dialog>
    </>
  );
}
