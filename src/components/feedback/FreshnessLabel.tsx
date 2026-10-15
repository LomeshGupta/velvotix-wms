"use client";
import Typography from "@mui/material/Typography";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useEffect, useState } from "react";

dayjs.extend(relativeTime);

/** States how old the figures are and the longest they can be out of date. Data freshness is never implied. */
export function FreshnessLabel({ generatedAt, maxAgeSeconds }: { generatedAt?: string; maxAgeSeconds?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!generatedAt) return null;
  return (
    <Typography variant="caption" color="text.secondary" role="status">
      Updated {dayjs(generatedAt).fromNow()}
      {maxAgeSeconds ? `, figures can be up to ${maxAgeSeconds} seconds behind Business Central` : ""}
    </Typography>
  );
}
