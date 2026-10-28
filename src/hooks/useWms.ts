"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError } from "@/services/api/bcRequest";
import {
  getDashboard,
  getTransactions,
  getTransaction,
  getWarehouseShipments,
  getWarehouseShipmentLines,
  getBins,
  lookupItem,
  searchItems,
  submitReceipt,
  submitOperation,
  getMonitor,
} from "@/services/api";
import type {
  ReceiptPayload,
  WmsOperationPayload,
} from "@/services/api/schemas";

export type {
  TransactionRow,
  DashboardData,
  WarehouseShipmentHit,
  WarehouseShipmentLineHit,
  BinHit,
  ItemHit,
  ReceiptPayload,
  WmsOperationType,
  WmsOperationPayload,
  MonitorData,
} from "@/services/api/schemas";

const jitter = (ms: number) => Math.round(ms * (0.85 + Math.random() * 0.3));
const IN_FLIGHT = new Set(["Submitted", "Queued", "Processing"]);
const TERMINAL = new Set([
  "Completed",
  "Failed",
  "Cancelled",
  "Requires Reconciliation",
  "Partially Completed",
]);
export const isTerminal = (status: string | undefined) =>
  Boolean(status && TERMINAL.has(status));

/** Retry only transient overload/service errors. Authentication and validation errors are not retried. */
const retryPolicy = (count: number, error: unknown) =>
  count < 2 && error instanceof ApiError && error.retryable;

export const useDashboard = () =>
  useQuery({
    queryKey: ["dashboard"],
    queryFn: ({ signal }) => getDashboard(signal),
    staleTime: 5_000,
    // Refresh more frequently while transactions are waiting/processing; back off when idle.
    refetchInterval: (query) => {
      const counts = query.state.data?.counts ?? {};
      const active =
        (counts.Submitted ?? 0) +
          (counts.Queued ?? 0) +
          (counts.Processing ?? 0) >
        0;
      return jitter(active ? 5_000 : 15_000);
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: retryPolicy,
  });

export const useTransactions = (status?: string) =>
  useQuery({
    queryKey: ["transactions", status ?? "all"],
    queryFn: ({ signal }) => getTransactions(status, signal),
    staleTime: 2_000,
    // Keep the list current while there is pending work, and still discover new rows while idle.
    refetchInterval: (query) => {
      const rows = query.state.data?.transactions ?? [];
      const active = rows.some((row) => IN_FLIGHT.has(row.status));
      return jitter(active ? 2_500 : 5_000);
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: retryPolicy,
  });

export const useTransaction = (id: string | null) =>
  useQuery({
    queryKey: ["transaction", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) => getTransaction(id!, signal),
    refetchInterval: (query) => {
      if (isTerminal(query.state.data?.transaction.status)) return false;
      const updates = query.state.dataUpdateCount;
      return jitter(Math.min(8000, 1500 + updates * 700));
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: retryPolicy,
  });

export const useWarehouseShipments = (locationCode: string) =>
  useQuery({
    queryKey: ["warehouse-shipments", locationCode],
    enabled: Boolean(locationCode),
    queryFn: ({ signal }) => getWarehouseShipments(locationCode, signal),
    staleTime: 15_000,
    retry: retryPolicy,
  });

export const useWarehouseShipmentLines = (
  locationCode: string,
  number: string,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ["warehouse-shipment-lines", locationCode, number],
    enabled: Boolean(locationCode && number && enabled),
    queryFn: ({ signal }) =>
      getWarehouseShipmentLines(locationCode, number, signal),
    staleTime: 15_000,
    retry: retryPolicy,
  });

export const useItemLookup = () =>
  useMutation({ mutationFn: (code: string) => lookupItem(code) });

export const useItemSearch = (search: string) =>
  useQuery({
    queryKey: ["items", search],
    queryFn: ({ signal }) => searchItems(search, signal),
    staleTime: 60_000,
    retry: retryPolicy,
  });

export const useSubmitReceipt = () =>
  useMutation({
    mutationFn: (payload: ReceiptPayload) => submitReceipt(payload),
  });

export const useSubmitOperation = () =>
  useMutation({
    mutationFn: (payload: WmsOperationPayload) => submitOperation(payload),
  });

export const useMonitor = () =>
  useQuery({
    queryKey: ["monitor"],
    queryFn: ({ signal }) => getMonitor(signal),
    refetchInterval: () => jitter(15_000),
    refetchIntervalInBackground: false,
    retry: retryPolicy,
  });

/** Bin suggestions for the selected warehouse (cached; the server re-validates on submit). */
export const useBins = (locationCode: string, enabled: boolean) =>
  useQuery({
    queryKey: ["bins", locationCode],
    enabled: enabled && Boolean(locationCode),
    queryFn: ({ signal }) => getBins(locationCode, "", signal),
    staleTime: 5 * 60_000,
    retry: retryPolicy,
  });
