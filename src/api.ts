import type { ApiResponse } from './types';
export async function request<T>(method: string, payload?: unknown): Promise<T> {
  if (window.civic) {
    const result = await window.civic.request<T>(method, payload);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }
  if (method === 'exportPdf') {
    window.print();
    return true as T;
  }
  if (method === 'exportCsv') {
    const response = await fetch('/api/export.csv', { credentials: 'same-origin' });
    if (!response.ok) {
      const error = await response.json() as ApiResponse<T>;
      throw new Error(error.ok ? 'Could not export CSV.' : error.error);
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = 'civicpulse-complaints.csv';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return true as T;
  }
  const response = await fetch('/api/request', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, payload })
  });
  const result: ApiResponse<T> = await response.json();
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
export function onNotice(callback: (message: string) => void): () => void {
  return window.civic?.onNotice(callback) || (() => {});
}
