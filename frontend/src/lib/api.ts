const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const json = JSON.parse(text);
      message = json.detail ?? json.message ?? text;
    } catch { /* not JSON */ }
    throw new Error(message);
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
  update: (resultId: string, data: Record<string, unknown>, fieldConfidences: Record<string, number>) =>
    request<ExtractionResult>(`/api/extraction/results/${resultId}`, { method: "PUT", body: JSON.stringify({ data, field_confidences: fieldConfidences }) }),
  deleteResult: (resultId: string) =>
    request<void>(`/api/extraction/results/${resultId}`, { method: "DELETE" }),
};

// --- Tax return endpoints ---
export const taxReturn = {
  get: () => request<TaxReturn>("/api/return"),
  summary: () => request<TaxSummary>("/api/return/summary"),
  update: (data: Record<string, unknown>) =>
    request<TaxReturn>("/api/return", { method: "PUT", body: JSON.stringify(data) }),
  calculate: () =>
    request<{ federal: Omit<CalcResult, 'federal_tax_withheld' | 'refund' | 'states' | 'total_income' | 'wages' | 'capital_gains'>; federal_tax_withheld: number; refund: number; states: Record<string, StateTaxResult>; total_income: number; wages: number; capital_gains: number }>(
      "/api/return/calculate",
      { method: "POST", body: "{}" }
    ).then((r) => ({ ...r.federal, federal_tax_withheld: r.federal_tax_withheld, refund: r.refund, states: r.states, total_income: r.total_income, wages: r.wages, capital_gains: r.capital_gains })),
  compareStatus: () => request<StatusComparison>("/api/return/compare-status", { method: "POST" }),
  checkCredits: () => request<CreditsResult>("/api/return/check-credits", { method: "POST" }),
  forms: () => request<FormsDetail>("/api/return/forms"),
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

export interface StateTaxResult {
  state_tax: number;
  effective_rate: number;
  no_income_tax: boolean;
  state_tax_withheld: number;
  refund: number;
}

export interface CalcResult {
  federal_tax: number;
  effective_rate: number;
  brackets: { rate: number; amount: number }[];
  credits: Record<string, number>;
  federal_tax_withheld: number;
  refund: number;
  states: Record<string, StateTaxResult>;
  total_income: number;
  wages: number;
  capital_gains: number;
}

export interface StatusComparison {
  statuses: { status: string; tax: number; refund: number }[];
  recommended: string;
}

export interface CreditsResult {
  eligible: { name: string; amount: number }[];
  total: number;
}

export interface W2Form {
  employer: string | null; employer_ein: string | null
  wages: number; federal_withheld: number
  social_security_wages: number; social_security_withheld: number
  medicare_wages: number; medicare_withheld: number
  state: string | null; state_wages: number; state_withheld: number
}
export interface Int1099 { payer: string | null; interest: number; early_withdrawal_penalty: number; federal_withheld: number; us_bond_interest: number }
export interface Div1099 { payer: string | null; ordinary_dividends: number; qualified_dividends: number; total_capital_gain: number; federal_withheld: number; exempt_interest_dividends: number }
export interface Nec1099 { payer: string | null; amount: number; federal_withheld: number }
export interface Misc1099 { payer: string | null; rents: number; royalties: number; other_income: number; federal_withheld: number }
export interface B1099 { payer: string | null; proceeds: number; cost_basis: number; gain_loss: number; federal_withheld: number; transaction_count: number }
export interface R1099 { payer: string | null; gross_distribution: number; taxable_amount: number; federal_withheld: number; distribution_code: string | null }
export interface G1099 { payer: string | null; unemployment_compensation: number; state_local_refund: number; federal_withheld: number }
export interface Da1099 { payer: string | null; gain_loss: number; federal_withheld: number; transaction_count: number }
export interface S1099 { payer: string | null; proceeds: number; cost_basis: number; gain_loss: number }
export interface FormsDetail {
  w2: W2Form[]; '1099_int': Int1099[]; '1099_div': Div1099[]
  '1099_nec': Nec1099[]; '1099_misc': Misc1099[]; '1099_b': B1099[]
  '1099_r': R1099[]; '1099_g': G1099[]; '1099_da': Da1099[]; '1099_s': S1099[]
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
