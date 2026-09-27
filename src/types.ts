export type Role = 'citizen' | 'staff' | 'admin' | 'superadmin';
export type User = { id: number; name: string; email: string; role: Role; area: string; departmentId: number | null; verifiedArea: boolean; active: boolean };
export type Complaint = {
  id: number; code: string; reporter_id: number | null; reporter: string; title: string; description: string;
  category_id: number; category: string; area: string; latitude: number; longitude: number;
  severity: string; priority: string; status: string; department_id: number | null; department: string | null;
  image: string | null; completion_image: string | null; duplicate_of: number | null; created_at: string; updated_at: string;
};
export type PublicComplaint = Pick<Complaint, 'id' | 'code' | 'title' | 'description' | 'category_id' | 'category' | 'area' | 'latitude' | 'longitude' | 'severity' | 'priority' | 'status' | 'department_id' | 'department' | 'created_at' | 'updated_at'>;
export type PageResult<T> = { complaints: T[]; nextCursor: number | null; total: number };
export type PublicSnapshot = PageResult<PublicComplaint> & { categories: Category[] };
export type Category = { id: number; name: string; department_id: number | null; active: number };
export type Department = { id: number; name: string; active: number };
export type Update = { id: number; complaint_id: number; actor_id: number | null; actor: string; action: string; old_status: string | null; new_status: string | null; note: string; created_at: string };
export type Cycle = { id: number; complaint_id: number; number: number; resolved_at: string; reopened_at: string | null; closed_at: string | null };
export type Feedback = { id: number; complaint_id: number; cycle_id: number; user_id: number | null; author: string; rating: number; resolution: string; comment: string; local: number; created_at: string };
export type Summary = { counts: { total: number; closed: number | null; open: number | null; pending: number | null; awaiting: number | null; critical: number | null }; categories: Array<{ id: number; count: number }>; areas: Array<{ area: string; count: number; open: number }>; departments: Array<{ id: number; count: number; resolved: number }>; reopened: number; feedback: { count: number; average: number | null }; own: { total: number; open: number | null; resolved: number | null }; assigned: { total: number; open: number | null; resolved: number | null } | null };
export type ComplaintDetail = { complaint: Complaint; updates: Update[]; cycles: Cycle[]; feedback: Feedback[] };
export type Snapshot = { user: User; complaints: Complaint[]; nextCursor: number | null; summary: Summary; categories: Category[]; departments: Department[]; updates: Update[]; cycles: Cycle[]; feedback: Feedback[]; users: Array<User & { department_id: number | null; verified_area: number; created_at: string }>; audit: Array<{ id: number; actor: string; action: string; target_type: string; target_id: number; detail: string; created_at: string }> };
export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string };
declare global { interface Window { civic?: { request: <T>(method: string, payload?: unknown) => Promise<ApiResponse<T>>; onNotice: (callback: (message: string) => void) => () => void } } }
