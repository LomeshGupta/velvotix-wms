"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError } from "@/services/api/bcRequest";
import {
  getDashboard,
  getTransactions,
  getTransaction,
  getWarehouseShipments,
  getWarehouseShipmentLines,
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
