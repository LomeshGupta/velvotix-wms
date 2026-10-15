"use client";

import { useEffect } from "react";

/** Registers the static-only service worker. Authenticated pages and API data are never cached. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Installation is optional; app functionality must not depend on service-worker availability.
    });
  }, []);
  return null;
}
