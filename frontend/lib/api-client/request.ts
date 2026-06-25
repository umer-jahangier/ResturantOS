import { apiClient } from "./client";
import type { ApiPaginatedResponse, ApiResponse, PageMeta } from "./types";

// Typed request helpers. They unwrap the `{data,meta,warnings}` envelope and
// return the INNER JSON as `unknown` — the repository is responsible for running
// it through a Zod `.parse()` before adapting. Helpers never know domain shapes.

export async function get<T = unknown>(
  url: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const response = await apiClient.get<ApiResponse<T>>(url, { params });
  return response.data.data;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PageMeta;
}

export async function getPaginated<T = unknown>(
  url: string,
  params?: Record<string, unknown>,
): Promise<PaginatedResult<T>> {
  const response = await apiClient.get<ApiPaginatedResponse<T>>(url, { params });
  return { data: response.data.data, meta: response.data.meta };
}

export async function post<TBody = unknown, T = unknown>(
  url: string,
  body?: TBody,
): Promise<T> {
  const response = await apiClient.post<ApiResponse<T>>(url, body);
  return response.data.data;
}

export async function patch<TBody = unknown, T = unknown>(
  url: string,
  body?: TBody,
): Promise<T> {
  const response = await apiClient.patch<ApiResponse<T>>(url, body);
  return response.data.data;
}

export async function del<T = unknown>(url: string): Promise<T> {
  const response = await apiClient.delete<ApiResponse<T>>(url);
  return response.data.data;
}
