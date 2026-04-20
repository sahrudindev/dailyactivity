export interface ActivityCode {
  code: string;
  color: string;
  fontColor: string;
  label: string;
}

export interface ActivityPayload {
  code: string;
  day: number;
  start_time: string;
  end_time: string;
  sheet_name: string;
}

export interface ApiResponse {
  status: "success" | "error";
  message: string;
  filled?: number;
  skipped?: number;
}

export interface FilledSlot {
  time: string;
  code: string;
  color: string;
}

export interface DayProgress {
  filled: number;
  total: number;
  percentage: number;
  filledSlots: FilledSlot[];
}

// ═══════════════════════════════════════════
//  TIME UTILITIES
// ═══════════════════════════════════════════

let _timeSlots: string[] | null = null;

export function generateTimeSlots(): string[] {
  if (_timeSlots) return _timeSlots;
  const slots: string[] = [];
  for (let h = 8; h <= 19; h++) {
    for (let m = 0; m < 60; m += 10) {
      if (h === 19 && m > 0) break;
      slots.push(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`);
    }
  }
  _timeSlots = slots;
  return slots;
}

export function calculateSlotCount(startTime: string, endTime: string): number {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return diff <= 0 ? 0 : Math.floor(diff / 10) + 1;
}

export function isValidInterval(time: string): boolean {
  if (!time) return false;
  return parseInt(time.split(":")[1], 10) % 10 === 0;
}

// ═══════════════════════════════════════════
//  CLIENT-SIDE CACHE
// ═══════════════════════════════════════════

const CACHE_TTL = 60_000; // 60 seconds

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    memoryCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T, ttl = CACHE_TTL): void {
  memoryCache.set(key, { data, expiry: Date.now() + ttl });
}

// ═══════════════════════════════════════════
//  API CALLS
// ═══════════════════════════════════════════

const SCRIPT_URL = process.env.NEXT_PUBLIC_SCRIPT_URL || "";

function ensureUrl(): string {
  if (!SCRIPT_URL) throw new Error("NEXT_PUBLIC_SCRIPT_URL is not configured.");
  return SCRIPT_URL;
}

export async function fetchSheetNames(): Promise<string[]> {
  const cached = getCached<string[]>("sheetNames");
  if (cached) return cached;

  const url = ensureUrl();
  const res = await fetch(`${url}?action=getSheets`);
  const data = await res.json();

  if (data.status === "ok" && Array.isArray(data.sheets)) {
    setCache("sheetNames", data.sheets);
    return data.sheets;
  }
  throw new Error("Failed to fetch sheet names");
}

export async function fetchSheetCodes(sheetName: string): Promise<ActivityCode[]> {
  const cacheKey = `codes_${sheetName}`;
  const cached = getCached<ActivityCode[]>(cacheKey);
  if (cached) return cached;

  const url = ensureUrl();
  const res = await fetch(`${url}?action=getCodes&sheet=${encodeURIComponent(sheetName)}`);
  const data = await res.json();

  if (data.status === "ok" && Array.isArray(data.codes)) {
    setCache(cacheKey, data.codes);
    return data.codes as ActivityCode[];
  }
  throw new Error(data.message || "Failed to fetch codes");
}

export async function fetchDayProgress(sheetName: string, day: number): Promise<DayProgress> {
  const cacheKey = `progress_${sheetName}_${day}`;
  const cached = getCached<DayProgress>(cacheKey);
  if (cached) return cached;

  const url = ensureUrl();
  const res = await fetch(`${url}?action=getDayProgress&sheet=${encodeURIComponent(sheetName)}&day=${day}`);
  const data = await res.json();

  if (data.status === "ok") {
    const progress: DayProgress = {
      filled: data.filled,
      total: data.total,
      percentage: data.percentage,
      filledSlots: (data.filledSlots || []).map((s: { time: string; code: string; color: string }) => ({
        time: s.time,
        code: s.code,
        color: s.color,
      })),
    };
    setCache(cacheKey, progress, 30_000); // 30s cache for progress
    return progress;
  }
  throw new Error(data.message || "Failed to fetch progress");
}

export async function submitActivity(payload: ActivityPayload): Promise<ApiResponse> {
  const url = ensureUrl();

  // Invalidate progress cache after submit
  memoryCache.delete(`progress_${payload.sheet_name}_${payload.day}`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    mode: "no-cors",
  });

  try {
    const data = await res.json();
    return data as ApiResponse;
  } catch {
    return {
      status: "success",
      message: `Activity "${payload.code}" submitted to "${payload.sheet_name}" for day ${payload.day}, ${payload.start_time} → ${payload.end_time}`,
    };
  }
}
