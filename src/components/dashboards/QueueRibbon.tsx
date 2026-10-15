"use client";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { STATUS_LABEL } from "@/components/feedback/StatusChip";

/**
 * One segmented bar showing where work sits right now. Segment width is the share of recent
 * transactions in that state; the legend repeats every number as text, so nothing depends on colour.
 */
const ORDER = ["Submitted", "Queued", "Processing", "Awaiting Approval", "Completed", "Partially Completed", "Requires Reconciliation", "Failed", "Cancelled"] as const;

export function QueueRibbon({ counts }: { counts: Record<string, number> }) {
  const theme = useTheme();
  const p = theme.vars?.palette;
  const color: Record<string, string> = {
    Submitted: p?.primary.main ?? "#3B5B7A",
    Queued: p?.primary.main ?? "#3B5B7A",
    Processing: p?.secondary.main ?? "#F2A900",
    "Awaiting Approval": p?.warning.main ?? "#8A5A00",
    Completed: p?.success.main ?? "#1E7F4F",
    "Partially Completed": p?.warning.main ?? "#8A5A00",
    "Requires Reconciliation": p?.error.main ?? "#B83227",
    Failed: p?.error.main ?? "#B83227",
    Cancelled: p?.text.secondary ?? "#4A5967",
  };
  const present = ORDER.filter((s) => (counts[s] ?? 0) > 0);
  const total = present.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const summary = present.map((s) => `${counts[s]} ${STATUS_LABEL(s).toLowerCase()}`).join(", ");

  if (total === 0) {
    return <Typography color="text.secondary">No transactions yet in your warehouses.</Typography>;
  }
  return (
    <Box>
      <Box role="img" aria-label={`Work by state: ${summary}`} sx={{ display: "flex", height: 28, borderRadius: "2px", overflow: "hidden", border: 1, borderColor: "divider" }}>
        {present.map((s) => (
          <Box
            key={s}
            title={`${STATUS_LABEL(s)}: ${counts[s]}`}
            sx={{
              flexGrow: counts[s], flexBasis: 0, minWidth: 6, bgcolor: color[s],
              // Attention states get a diagonal hatch so they differ from calm states without relying on hue.
              ...(s === "Failed" || s === "Requires Reconciliation"
                ? { backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,.35) 0 4px, transparent 4px 8px)" }
                : {}),
              "& + &": { borderLeft: 2, borderColor: "background.paper" },
            }}
          />
        ))}
      </Box>
      <Stack direction="row" flexWrap="wrap" columnGap={3} rowGap={0.5} sx={{ mt: 1.5 }} component="ul" style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
        {present.map((s) => (
          <Box component="li" key={s} sx={{ display: "flex", alignItems: "baseline", gap: 0.75 }}>
            <Box aria-hidden sx={{ width: 10, height: 10, bgcolor: color[s], borderRadius: "1px", alignSelf: "center" }} />
            <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{counts[s]}</Typography>
            <Typography variant="body2" color="text.secondary">{STATUS_LABEL(s)}</Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
