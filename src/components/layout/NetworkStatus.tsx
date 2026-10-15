"use client";
import Chip from "@mui/material/Chip";
import WifiOff from "@mui/icons-material/WifiOff";
import { useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

export const useOnline = (): boolean => useSyncExternalStore(subscribe, () => navigator.onLine, () => true);

/** Visible only when offline. Submissions are blocked while offline; nothing is silently queued. */
export function NetworkStatus() {
  const online = useOnline();
  if (online) return null;
  return <Chip size="small" color="warning" icon={<WifiOff />} label="Offline" role="status" />;
}
