"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { DocKind, LocationSetup } from "@/features/documents/kinds";
import { ApiError } from "@/services/api/bcRequest";
import {
  getDashboard,
  getTransactions,
  getTransaction,
  getWarehouseShipments,
  getWarehouseShipmentLines,
  getBins,
  getWorkRows,
  lookupItem,
  searchItems,
  submitReceipt,
  submitOperation,
  getMonitor,
} from "@/services/api";
import type { ReceiptPayload, WmsOperationPayload } from "@/services/api/schemas";

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

/** Retry only transient overload/service errors. Authentication and validation errors are not retried. */
const retryPolicy = (count: number, error: unknown) => count < 2 && error instanceof ApiError && error.retryable;

export const useDashboard = () =>
  useQuery({
    queryKey: ["dashboard"],
    queryFn: ({ signal }) => getDashboard(signal),
    staleTime: 20_000,
    refetchInterval: () => jitter(45_000),
    refetchIntervalInBackground: false,
    retry: retryPolicy,
  });

export const useTransactions = (status?: string) =>
  useQuery({
    queryKey: ["transactions", status ?? "all"],
    queryFn: ({ signal }) => getTransactions(status, signal),
    staleTime: 15_000,
    retry: retryPolicy,
  });

const TERMINAL = new Set(["Completed", "Failed", "Cancelled", "Requires Reconciliation", "Partially Completed"]);
export const isTerminal = (status: string | undefined) => Boolean(status && TERMINAL.has(status));

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

export const useWarehouseShipmentLines = (locationCode: string, number: string, enabled: boolean) =>
  useQuery({
    queryKey: ["warehouse-shipment-lines", locationCode, number],
    enabled: Boolean(locationCode && number && enabled),
    queryFn: ({ signal }) => getWarehouseShipmentLines(locationCode, number, signal),
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
  useMutation({ mutationFn: (payload: ReceiptPayload) => submitReceipt(payload) });

export const useSubmitOperation = () =>
  useMutation({ mutationFn: (payload: WmsOperationPayload) => submitOperation(payload) });

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

/** Work documents for the workbench, by kind. Shipments keep their dedicated routes; inbound kinds use /api/wms/work-docs. */
export const useWorkDocs = (kind: DocKind, locationCode: string, enabled: boolean) =>
  useQuery({
    queryKey: ["work-docs", kind, locationCode],
    enabled: Boolean(locationCode && enabled),
    queryFn: async ({ signal }): Promise<Record<string, unknown>[]> => {
      if (kind === "shipment") return (await getWarehouseShipments(locationCode, signal)).shipments as unknown as Record<string, unknown>[];
      const api = kind === "receipt" ? "receipts" : kind === "purchase" ? "purchase-orders" : "putaways";
      return (await getWorkRows(api, locationCode, undefined, signal)).rows;
    },
    staleTime: 15_000,
    retry: retryPolicy,
  });

export const useWorkDocLines = (kind: DocKind, locationCode: string, number: string, enabled: boolean) =>
  useQuery({
    queryKey: ["work-doc-lines", kind, locationCode, number],
    enabled: Boolean(locationCode && number && enabled),
    queryFn: async ({ signal }): Promise<Record<string, unknown>[]> => {
      if (kind === "shipment") return (await getWarehouseShipmentLines(locationCode, number, signal)).lines as unknown as Record<string, unknown>[];
      const api = kind === "receipt" ? "receipt-lines" : kind === "purchase" ? "purchase-lines" : "putaway-lines";
      return (await getWorkRows(api, locationCode, number, signal)).rows;
    },
    staleTime: 15_000,
    retry: retryPolicy,
  });

/** Warehouse configuration of a location (receive/put-away/pick/shipment/bins), to choose the right standard process. */
export const useLocationSetup = (locationCode: string, enabled: boolean) =>
  useQuery({
    queryKey: ["location-setup", locationCode],
    enabled: Boolean(locationCode && enabled),
    queryFn: async ({ signal }): Promise<LocationSetup | undefined> => (await getWorkRows("location-setup", locationCode, undefined, signal)).rows[0] as unknown as LocationSetup | undefined,
    staleTime: 5 * 60_000,
    retry: retryPolicy,
  });
