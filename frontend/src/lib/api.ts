const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

// --- API Key endpoints ---
export const apiKeys = {
  list: () => request<{ provider: string; model_name: string }[]>("/api/keys"),
  create: (body: { provider: string; api_key: string; model_name: string }) =>
    request<{ provider: string }>("/api/keys", { method: "POST", body: JSON.stringify(body) }),
  delete: (provider: string) =>
    request<void>(`/api/keys/${provider}`, { method: "DELETE" }),
  test: (body: { provider: string; api_key: string; model_name: string }) =>
    request<{ ok: boolean; error?: string }>("/api/keys/test", { method: "POST", body: JSON.stringify(body) }),
  testSaved: (provider: string) =>
    request<{ ok: boolean; error?: string }>(`/api/keys/${provider}/test`, { method: "POST" }),
};

// --- Document endpoints ---
export const documents = {
  upload: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return request<{ ids: string[] }>("/api/documents/upload", {
      method: "POST",
      headers: {},
      body: form,
    });
  },
  list: () => request<Document[]>("/api/documents"),
  get: (id: string) => request<Document>(`/api/documents/${id}`),
  delete: (id: string) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),
  updateDocType: (id: string, doc_type: string | null) =>
    request<Document>(`/api/documents/${id}`, { method: "PATCH", body: JSON.stringify({ doc_type }) }),
  previewUrl: (id: string) => `${BASE_URL}/api/documents/${id}/preview`,
};

// --- Extraction endpoints ---
export const extraction = {
  run: (docId: string) => request<{ job_id: string }>(`/api/extraction/${docId}/run`, { method: "POST" }),
  results: (docId: string) => request<ExtractionResult[]>(`/api/extraction/${docId}/result`),
  update: (resultId: string, data: Record<string, unknown>) =>
    request<ExtractionResult>(`/api/extraction/results/${resultId}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteResult: (resultId: string) =>
    request<void>(`/api/extraction/results/${resultId}`, { method: "DELETE" }),
};

// --- Tax return endpoints ---
export const taxReturn = {
  get: () => request<TaxReturn>("/api/return"),
  summary: () => request<TaxSummary>("/api/return/summary"),
  update: (data: Record<string, unknown>) =>
    request<TaxReturn>("/api/return", { method: "PUT", body: JSON.stringify(data) }),
  calculate: () => request<CalcResult>("/api/return/calculate", { method: "POST" }),
  compareStatus: () => request<StatusComparison>("/api/return/compare-status", { method: "POST" }),
  checkCredits: () => request<CreditsResult>("/api/return/check-credits", { method: "POST" }),
};

// --- Filing endpoints ---
export const filing = {
  start: (body: { olt_username: string; olt_password: string }) =>
    request<{ session_id: string }>("/api/filing/start", { method: "POST", body: JSON.stringify(body) }),
  session: (id: string) => request<FilingSession>(`/api/filing/sessions/${id}`),
  stop: (id: string) => request<void>(`/api/filing/sessions/${id}/stop`, { method: "POST" }),
  streamUrl: (id: string) => `${BASE_URL}/api/filing/sessions/${id}/stream`,
  screenshotUrl: (id: string) => `${BASE_URL}/api/filing/sessions/${id}/screenshot`,
};

// --- Shared types (minimal, expanded in Phase 5) ---
export interface Document {
  id: string;
  filename: string;
  file_type: string;
  doc_type: string | null;
  status: "uploaded" | "extracting" | "extracted" | "error";
  error_msg: string | null;
  created_at: string;
}

export interface ExtractionResult {
  id: string;
  document_id: string;
  form_type: string;
  data: Record<string, unknown>;
  confidence: number;
  field_confidences: Record<string, number>;
  user_verified: boolean;
}

export interface TaxReturn {
  id: string;
  tax_year: number;
  filing_status: string;
  data: Record<string, unknown>;
  calc_results: Record<string, unknown> | null;
  status: string;
}

export interface TaxSummary {
  total_income: number;
  total_deductions: number;
  estimated_tax: number;
  estimated_refund: number;
}

export interface CalcResult {
  federal_tax: number;
  effective_rate: number;
  brackets: { rate: number; amount: number }[];
  credits: Record<string, number>;
}

export interface StatusComparison {
  statuses: { status: string; tax: number; refund: number }[];
  recommended: string;
}

export interface CreditsResult {
  eligible: { name: string; amount: number }[];
  total: number;
}

export interface FilingSession {
  id: string;
  status: "running" | "stopped" | "completed" | "error";
  current_step: string | null;
  steps_log: string[];
  error_msg: string | null;
  started_at: string;
  completed_at: string | null;
}
