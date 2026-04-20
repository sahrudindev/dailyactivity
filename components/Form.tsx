"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  generateTimeSlots,
  calculateSlotCount,
  isValidInterval,
  submitActivity,
  fetchSheetNames,
  fetchSheetCodes,
  fetchDayProgress,
  type ActivityCode,
  type ActivityPayload,
  type DayProgress,
  type FilledSlot,
} from "@/lib/api";

const TIME_SLOTS = generateTimeSlots();

/** Determine if a hex background is light (needs dark text) */
function isLightBg(hex: string): boolean {
  if (!hex || hex === "#ffffff") return true;
  const c = hex.replace("#", "");
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}

export default function ActivityForm() {
  const [sheetName, setSheetName] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetsLoading, setSheetsLoading] = useState(true);
  const [sheetsError, setSheetsError] = useState("");

  const [sheetCodes, setSheetCodes] = useState<ActivityCode[]>([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [codesError, setCodesError] = useState("");

  const [dayProgress, setDayProgress] = useState<DayProgress | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);

  const [code, setCode] = useState("");
  const [day, setDay] = useState<number | "">("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Fetch sheet names on mount
  useEffect(() => {
    let cancelled = false;
    setSheetsLoading(true);
    setSheetsError("");
    fetchSheetNames()
      .then((names) => { if (!cancelled) { setSheetNames(names); setSheetsLoading(false); } })
      .catch((err) => { if (!cancelled) { setSheetsError(err instanceof Error ? err.message : "Failed to load sheets"); setSheetsLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  // Fetch codes when sheet changes
  useEffect(() => {
    if (!sheetName) { setSheetCodes([]); setCode(""); return; }
    let cancelled = false;
    setCodesLoading(true);
    setCodesError("");
    setCode("");
    setSheetCodes([]);
    fetchSheetCodes(sheetName)
      .then((codes) => { if (!cancelled) { setSheetCodes(codes); setCodesLoading(false); } })
      .catch((err) => { if (!cancelled) { setCodesError(err instanceof Error ? err.message : "Failed"); setCodesLoading(false); } });
    return () => { cancelled = true; };
  }, [sheetName]);

  // Fetch day progress when sheet + day change
  useEffect(() => {
    if (!sheetName || day === "" || day < 1 || day > 31) { setDayProgress(null); return; }
    let cancelled = false;
    setProgressLoading(true);
    fetchDayProgress(sheetName, day)
      .then((p) => { if (!cancelled) { setDayProgress(p); setProgressLoading(false); } })
      .catch(() => { if (!cancelled) { setDayProgress(null); setProgressLoading(false); } });
    return () => { cancelled = true; };
  }, [sheetName, day]);

  const slotCount = useMemo(() => calculateSlotCount(startTime, endTime), [startTime, endTime]);
  const endTimeSlots = useMemo(() => {
    if (!startTime) return TIME_SLOTS;
    return TIME_SLOTS.filter((t) => t > startTime);
  }, [startTime]);

  const errors = useMemo(() => {
    const e: string[] = [];
    if (day !== "" && (day < 1 || day > 31)) e.push("Day must be between 1 and 31");
    if (startTime && !isValidInterval(startTime)) e.push("Start time must be on a 10-minute interval");
    if (endTime && !isValidInterval(endTime)) e.push("End time must be on a 10-minute interval");
    if (startTime && endTime && startTime >= endTime) e.push("Start time must be before end time");
    return e;
  }, [day, startTime, endTime]);

  const isFormValid =
    sheetName !== "" && code !== "" && day !== "" && day >= 1 && day <= 31 &&
    startTime !== "" && endTime !== "" && errors.length === 0 && slotCount > 0;

  const addToast = useCallback((type: "success" | "error", message: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => { setToasts((prev) => prev.filter((t) => t.id !== id)); }, 5000);
  }, []);

  const handleSubmit = async () => {
    if (!isFormValid || isSubmitting) return;
    const payload: ActivityPayload = { code, day: day as number, start_time: startTime, end_time: endTime, sheet_name: sheetName };
    setIsSubmitting(true);
    setShowPreview(false);
    try {
      const result = await submitActivity(payload);
      addToast("success", result.message);
      setCode(""); setDay(""); setStartTime(""); setEndTime(""); setDayProgress(null);
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Failed to submit activity");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setCode(""); setDay(""); setStartTime(""); setEndTime(""); setShowPreview(false);
  };

  const selectedCodeInfo = sheetCodes.find((c) => c.code === code);

  // Map of filled time slots: time -> { code, color }
  const filledSlotsMap = useMemo(() => {
    const map = new Map<string, FilledSlot>();
    if (!dayProgress?.filledSlots) return map;
    for (const slot of dayProgress.filledSlots) {
      map.set(slot.time, slot);
    }
    return map;
  }, [dayProgress]);

  const getProgressColor = (pct: number) => {
    if (pct >= 100) return "#16a34a";
    if (pct >= 70) return "#4f46e5";
    if (pct >= 40) return "#d97706";
    return "#dc2626";
  };

  // Progress data for preview (default 0/50 if not loaded yet)
  const progressData: DayProgress = dayProgress || { filled: 0, total: 50, percentage: 0, filledSlots: [] };

  return (
    <div className="w-full">
      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`animate-slide-in flex items-center gap-3 px-5 py-3.5 rounded-xl text-sm font-medium shadow-lg border ${
              toast.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            <span className="text-lg">{toast.type === "success" ? "✓" : "✕"}</span>
            {toast.message}
          </div>
        ))}
      </div>

      <div className="lg:grid lg:grid-cols-12 lg:gap-8 items-start">
        {/* Left Column: Main Form */}
        <div className="lg:col-span-7">
          <div className="glass-card rounded-3xl p-6 sm:p-8 lg:p-10 animate-fade-in-up">
            <div className="mb-8">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-800 mb-2 tracking-tight">Log Activity</h2>
              <p className="text-slate-500 text-sm leading-relaxed">
                Fill in the details below to record your team activity into the sheet.
              </p>
            </div>

            <div className="space-y-6">
              {/* Sheet selector */}
              <div>
                <label htmlFor="sheet-select" className="block text-sm font-bold text-slate-700 mb-2">
                  Team Member (Sheet)
                </label>
                {sheetsLoading ? (
                  <div className="form-input w-full px-4 py-3.5 rounded-2xl text-sm flex items-center gap-3 text-slate-400 animate-pulse">
                    <svg className="animate-spin h-5 w-5 text-indigo-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Fetching members...
                  </div>
                ) : sheetsError ? (
                  <div className="p-4 rounded-2xl bg-red-50 border border-red-100">
                    <p className="text-sm text-red-600 flex items-center gap-2 font-medium">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {sheetsError}
                    </p>
                    <button type="button" onClick={() => {
                      setSheetsLoading(true); setSheetsError("");
                      fetchSheetNames().then((n) => { setSheetNames(n); setSheetsLoading(false); }).catch((e) => { setSheetsError(e instanceof Error ? e.message : "Failed"); setSheetsLoading(false); });
                    }} className="mt-2 text-sm text-indigo-600 font-bold hover:text-indigo-700 transition-colors">Try again</button>
                  </div>
                ) : (
                  <select id="sheet-select" value={sheetName} onChange={(e) => setSheetName(e.target.value)} className="form-input w-full px-4 py-3.5 rounded-2xl text-sm font-medium">
                    <option value="">Select a team member...</option>
                    {sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                )}
              </div>

              {/* Activity Code */}
              <div>
                <label htmlFor="activity-code" className="block text-sm font-bold text-slate-700 mb-2">
                  Activity Code
                </label>
                {codesLoading ? (
                  <div className="form-input w-full px-4 py-3.5 rounded-2xl text-sm flex items-center gap-3 text-slate-400 animate-pulse">
                    <svg className="animate-spin h-5 w-5 text-indigo-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Loading available codes...
                  </div>
                ) : codesError ? (
                  <div className="p-4 rounded-2xl bg-red-50 border border-red-100">
                    <p className="text-sm text-red-600 font-medium flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {codesError}
                    </p>
                  </div>
                ) : !sheetName ? (
                  <select id="activity-code" disabled className="form-input w-full px-4 py-3.5 rounded-2xl text-sm font-medium">
                    <option>Please select a team member first...</option>
                  </select>
                ) : (
                  <select id="activity-code" value={code} onChange={(e) => setCode(e.target.value)} className="form-input w-full px-4 py-3.5 rounded-2xl text-sm font-medium">
                    <option value="">Select an activity type...</option>
                    {sheetCodes.map((item) => (
                      <option key={item.code} value={item.code}>{item.code} — {item.label}</option>
                    ))}
                  </select>
                )}
                
                {/* Selected Code Feedback */}
                {selectedCodeInfo && (
                  <div className="mt-3 flex items-center gap-3 p-3 bg-slate-50/80 rounded-xl border border-slate-100 animate-fade-in-up">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shadow-sm ring-1 ring-black/5"
                      style={{ backgroundColor: selectedCodeInfo.color, color: selectedCodeInfo.fontColor }}>
                      {selectedCodeInfo.code}
                    </div>
                    <span className="text-sm text-slate-600 font-medium">{selectedCodeInfo.label}</span>
                  </div>
                )}
              </div>

              {/* Day & Time Range Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <div>
                  <label htmlFor="day-input" className="block text-sm font-bold text-slate-700 mb-2">Day of Month</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    <input id="day-input" type="number" min={1} max={31} value={day}
                      onChange={(e) => { const v = e.target.value; setDay(v === "" ? "" : parseInt(v, 10)); }}
                      placeholder="DD" className="form-input w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm font-medium" />
                  </div>
                </div>
                <div>
                  <label htmlFor="start-time" className="block text-sm font-bold text-slate-700 mb-2">Start Time</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <select id="start-time" value={startTime}
                      onChange={(e) => { setStartTime(e.target.value); if (endTime && e.target.value >= endTime) setEndTime(""); }}
                      className="form-input w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm font-medium">
                      <option value="">Start</option>
                      {TIME_SLOTS.slice(0, -1).map((t) => {
                        const slot = filledSlotsMap.get(t);
                        return (
                          <option key={t} value={t} disabled={!!slot}
                            style={slot ? { backgroundColor: slot.color, color: isLightBg(slot.color) ? "#1a1a1a" : "#ffffff" } : undefined}>
                            {t}{slot ? ` ■ ${slot.code} (Terisi)` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="end-time" className="block text-sm font-bold text-slate-700 mb-2">End Time</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <select id="end-time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                      className="form-input w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm font-medium" disabled={!startTime}>
                      <option value="">End</option>
                      {endTimeSlots.map((t) => {
                        const slot = filledSlotsMap.get(t);
                        return (
                          <option key={t} value={t} disabled={!!slot}
                            style={slot ? { backgroundColor: slot.color, color: isLightBg(slot.color) ? "#1a1a1a" : "#ffffff" } : undefined}>
                            {t}{slot ? ` ■ ${slot.code} (Terisi)` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
              </div>

              {/* Form Validation Errors */}
              {errors.length > 0 && (
                <div className="p-4 rounded-2xl bg-red-50 border border-red-100 animate-fade-in-up">
                  {errors.map((err, i) => (
                    <p key={i} className="text-sm text-red-600 font-medium flex items-center gap-2 mb-1 last:mb-0">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {err}
                    </p>
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-4 flex flex-col sm:flex-row gap-4">
                <button id="reset-btn" type="button" onClick={handleReset}
                  className="px-6 py-4 rounded-2xl text-sm font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all duration-200 focus:ring-4 focus:ring-slate-100">
                  Reset
                </button>
                <button id="submit-btn" type="button" onClick={handleSubmit} disabled={!isFormValid || isSubmitting}
                  className={`flex-1 px-6 py-4 rounded-2xl text-sm font-bold transition-all duration-300 group relative overflow-hidden ${
                    isFormValid && !isSubmitting
                      ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-700 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-indigo-600/30 cursor-pointer focus:ring-4 focus:ring-indigo-500/20"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                  }`}>
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {isSubmitting ? (
                      <>
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Saving to Sheet...
                      </>
                    ) : (
                      <>
                        Confirm Activity
                        <svg className={`w-4 h-4 transition-transform duration-300 ${isFormValid ? 'group-hover:translate-x-1' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                      </>
                    )}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Preview & Legend */}
        <div className="lg:col-span-5 space-y-6 mt-8 lg:mt-0 lg:sticky lg:top-24">
          
          {/* Daily Progress Widget */}
          {sheetName && day !== "" && day >= 1 && day <= 31 && (
            <div className="glass-card rounded-3xl p-6 sm:p-8 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-800 tracking-tight">Daily Quota</h3>
                  <p className="text-xs text-slate-500 font-medium">Target: 9 hours (50 slots)</p>
                </div>
              </div>

              <div className="mb-2 flex items-end justify-between">
                <span className="text-3xl font-extrabold tracking-tighter" style={{ color: getProgressColor(progressData.percentage) }}>
                  {progressLoading ? "..." : progressData.filled}
                  <span className="text-lg text-slate-400 font-bold ml-1">/ {progressData.total}</span>
                </span>
                <span className="text-sm font-bold text-slate-500 mb-1">
                  {progressLoading ? "..." : `${progressData.percentage}%`}
                </span>
              </div>
              
              <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50 shadow-inner">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden"
                  style={{
                    width: `${Math.min(progressData.percentage, 100)}%`,
                    backgroundColor: getProgressColor(progressData.percentage),
                  }}
                >
                  <div className="absolute inset-0 bg-white/20 w-full animate-shimmer" />
                </div>
              </div>

              {progressData.percentage >= 100 ? (
                <div className="mt-5 p-3.5 bg-emerald-50 rounded-xl border border-emerald-100 flex items-center gap-3">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">🎉</span>
                  <p className="text-sm font-bold text-emerald-700 leading-tight">Daily target achieved! Great job!</p>
                </div>
              ) : (
                <p className="mt-4 text-xs font-medium text-slate-500 text-center">
                  {progressData.total - progressData.filled} slots remaining to reach 100%
                </p>
              )}
            </div>
          )}

          {/* Activity Legend Card */}
          {sheetCodes.length > 0 && (
            <div className="glass-card rounded-3xl p-6 sm:p-8 animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-800 tracking-tight">Activity Legend</h3>
                  <p className="text-xs text-slate-500 font-medium truncate max-w-[200px]">{sheetName}</p>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {sheetCodes.map((item) => (
                  <div key={item.code} 
                    onClick={() => setCode(item.code)}
                    className={`flex items-center gap-3 p-3 rounded-2xl transition-all duration-200 cursor-pointer border ${code === item.code ? 'bg-white shadow-md border-indigo-100 ring-2 ring-indigo-500/20 scale-[1.02]' : 'bg-slate-50/50 border-slate-100 hover:bg-white hover:shadow-sm hover:border-slate-200'}`}>
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-xl text-sm font-bold shadow-sm ring-1 ring-black/5"
                      style={{ backgroundColor: item.color, color: item.fontColor }}>
                      {item.code}
                    </span>
                    <span className="text-sm font-medium text-slate-700 leading-snug">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Slot Summary Indicator */}
          {startTime && endTime && slotCount > 0 && (
            <div className="glass-card rounded-3xl p-6 sm:p-8 animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
               <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-extrabold text-slate-800">Time Range Selection</h4>
                  <p className="text-xs font-medium text-slate-500 mt-1">{startTime} to {endTime}</p>
                </div>
                <div className="flex flex-col items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 shadow-inner">
                  <span className="text-xl font-extrabold text-indigo-600 leading-none">{slotCount}</span>
                  <span className="text-[10px] font-bold text-indigo-400 mt-1 uppercase">Slots</span>
                </div>
               </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
