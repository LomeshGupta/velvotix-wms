"use client";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "flex-end" }} justifyContent="space-between" sx={{ mb: 3 }}>
      <Box>
        <Typography variant="h1" component="h1">{title}</Typography>
        {subtitle && <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 0.5 }}>{subtitle}</Typography>}
      </Box>
      {actions && <Box>{actions}</Box>}
    </Stack>
  );
}
