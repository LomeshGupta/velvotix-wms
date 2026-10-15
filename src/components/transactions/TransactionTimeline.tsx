"use client";
import Step from "@mui/material/Step";
import StepContent from "@mui/material/StepContent";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import Typography from "@mui/material/Typography";
import type { TransactionRow } from "@/hooks/useWms";

/**
 * Shows exactly what Business Central has told us. The last step only reads "Received" when the
 * status is Completed; accepted or processing never counts as done.
 */
export function TransactionTimeline({ tx, noun = "Receipt" }: { tx: Pick<TransactionRow, "status" | "resultDocumentNo" | "errorCode" | "errorMessage" | "attemptCount">; noun?: string }) {
  const s = tx.status;
  const waiting = s === "Submitted" || s === "Queued" || s === "Draft";
  const active = waiting ? 1 : s === "Processing" ? 1 : 2;
  const failed = s === "Failed" || s === "Cancelled";
  const check = s === "Requires Reconciliation" || s === "Partially Completed";

  return (
    <Stepper orientation="vertical" activeStep={s === "Completed" ? 3 : active} aria-live="polite">
      <Step completed>
        <StepLabel>{noun} saved in Business Central</StepLabel>
      </Step>
      <Step completed={!waiting && s !== "Processing"}>
        <StepLabel>{s === "Processing" ? "Being processed" : waiting ? "Waiting to be processed" : "Processed"}</StepLabel>
        {s === "Queued" && (tx.attemptCount ?? 0) > 1 && (
          <StepContent><Typography variant="body2" color="text.secondary">A temporary problem delayed this. It will retry automatically (attempt {tx.attemptCount}).</Typography></StepContent>
        )}
      </Step>
      <Step completed={s === "Completed"}>
        <StepLabel error={failed || check}>
          {s === "Completed" ? `${noun} completed${tx.resultDocumentNo ? `, document ${tx.resultDocumentNo}` : ""}`
            : failed ? (s === "Cancelled" ? "Cancelled" : "Could not be completed")
            : check ? "Outcome needs checking" : "Result"}
        </StepLabel>
        {(failed || check) && (
          <StepContent>
            <Typography variant="body2">
              {s === "Failed" && (tx.errorCode === "OPERATION_NOT_IMPLEMENTED" ? "This operation is not available in this version yet." : tx.errorMessage || "Business Central rejected this transaction.")}
              {s === "Requires Reconciliation" && "Business Central could not confirm whether this was applied. A supervisor must check it before it is repeated."}
              {s === "Partially Completed" && "Only part of this transaction was applied. A supervisor must review it."}
              {s === "Cancelled" && "This transaction was cancelled before processing."}
            </Typography>
            {tx.errorCode && <Typography variant="caption" color="text.secondary">Reference: {tx.errorCode}</Typography>}
          </StepContent>
        )}
      </Step>
    </Stepper>
  );
}
