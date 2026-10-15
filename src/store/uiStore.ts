"use client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** In-memory session facts (never persisted): the CSRF token comes from the server on each page load. */
interface SessionState {
  csrfToken: string | null;
  setCsrfToken: (t: string) => void;
  userId: string | null;
  setUserId: (id: string) => void;
  selectedLocation: string | null;
  setSelectedLocation: (code: string) => void;
  warehouseCodes: string[];
  setWarehouseCodes: (codes: string[]) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  csrfToken: null,
  setCsrfToken: (csrfToken) => set({ csrfToken }),
  userId: null,
  setUserId: (userId) => set({ userId }),
  selectedLocation: null,
  setSelectedLocation: (selectedLocation) => set({ selectedLocation }),
  warehouseCodes: [],
  setWarehouseCodes: (warehouseCodes) => set({ warehouseCodes }),
}));

export interface DraftLine {
  itemNo: string;
  description: string;
  unitOfMeasureCode: string;
  quantity: number;
  lotNo: string;
}

interface ReceiptDraft {
  /** Created once per receipt so a retry (or reload + resubmit) reaches BC as the same submission. */
  clientKey: string;
  locationCode: string;
  sourceDocumentNo: string;
  lines: DraftLine[];
  /** Set once BC accepted the draft; used to resume status tracking after a reload. */
  transactionId: string | null;
  userId: string;
}

interface DraftState {
  draft: ReceiptDraft | null;
  update: (fn: (d: ReceiptDraft) => ReceiptDraft, init: () => ReceiptDraft) => void;
  reset: () => void;
}

/**
 * Receipt draft kept in sessionStorage so an accidental reload does not lose scanned work.
 * It holds only item numbers, quantities and lots: no tokens, no BC responses. It is cleared on
 * logout and when the tab closes. A draft is NOT a submitted receipt and is never shown as one.
 */
export const useDraftStore = create<DraftState>()(
  persist(
    (set, get) => ({
      draft: null,
      update: (fn, init) => set({ draft: fn(get().draft ?? init()) }),
      reset: () => set({ draft: null }),
    }),
    { name: "wms-receipt-draft", storage: createJSONStorage(() => sessionStorage) },
  ),
);
