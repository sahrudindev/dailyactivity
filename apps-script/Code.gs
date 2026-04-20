/**
 * ========================================================
 * AP&M Team Activity Tracker — Google Apps Script Backend
 * ========================================================
 *
 * OPTIMIZED VERSION:
 * - Batch reads (getRange for entire columns at once)
 * - Batch writes (setValues/setBackgrounds for ranges)
 * - CacheService for sheet names & codes (60s TTL)
 * - Minimal API calls to SpreadsheetApp
 *
 * SETUP:
 * 1. Open Google Sheet → Extensions → Apps Script
 * 2. Paste this code into Code.gs
 * 3. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy URL → .env.local NEXT_PUBLIC_SCRIPT_URL
 */

// ═══════════════════════════════════════════
//  TIME UTILITIES
// ═══════════════════════════════════════════

var TIME_SLOTS_CACHE = null;

function generateTimeSlots() {
  if (TIME_SLOTS_CACHE) return TIME_SLOTS_CACHE;
  var slots = [];
  for (var h = 8; h <= 19; h++) {
    for (var m = 0; m < 60; m += 10) {
      if (h === 19 && m > 0) break;
      slots.push((h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m);
    }
  }
  TIME_SLOTS_CACHE = slots;
  return slots;
}

function getRowForTime(time) {
  var slots = generateTimeSlots();
  var idx = slots.indexOf(time);
  return idx === -1 ? -1 : idx + 2;
}

function getColumnForDay(day) {
  return day + 1;
}

// ═══════════════════════════════════════════
//  DYNAMIC CODE READING (BATCH OPTIMIZED)
// ═══════════════════════════════════════════

function findKodeColumn(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 2) return -1;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === "kode") return i + 1;
  }
  return -1;
}

/**
 * OPTIMIZED: Batch-read codes, colors, and labels in 2 API calls instead of N.
 */
function getCodesFromSheet(sheet) {
  var kodeCol = findKodeColumn(sheet);
  if (kodeCol === -1) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var numRows = lastRow - 1;

  // Batch read: values + backgrounds for Kode column, values for label column
  var kodeRange = sheet.getRange(2, kodeCol, numRows, 1);
  var labelRange = sheet.getRange(2, kodeCol + 1, numRows, 1);

  var kodeValues = kodeRange.getValues();
  var kodeColors = kodeRange.getBackgrounds();
  var labelValues = labelRange.getValues();

  var codes = [];
  var seen = {};

  for (var i = 0; i < kodeValues.length; i++) {
    var code = String(kodeValues[i][0]).trim();
    if (!code || code === "undefined" || code === "null") continue;
    if (!/^[A-Za-z]/.test(code)) continue;
    if (seen[code]) continue; // Deduplicate
    seen[code] = true;

    var bg = kodeColors[i][0];
    var label = String(labelValues[i][0]).trim();

    codes.push({
      code: code,
      color: bg,
      fontColor: isLightColor(bg) ? "#1a1a1a" : "#ffffff",
      label: label || code,
    });
  }

  return codes;
}

function isLightColor(hex) {
  if (!hex || hex === "#ffffff" || hex === "white") return true;
  if (hex === "#000000" || hex === "black") return false;
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  var r = parseInt(hex.substr(0, 2), 16);
  var g = parseInt(hex.substr(2, 2), 16);
  var b = parseInt(hex.substr(4, 2), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

// ═══════════════════════════════════════════
//  CACHING (60 second TTL)
// ═══════════════════════════════════════════

function getCachedSheetNames() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("sheetNames");
  if (cached) return JSON.parse(cached);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var names = ss.getSheets().map(function(s) { return s.getName(); });
  cache.put("sheetNames", JSON.stringify(names), 60);
  return names;
}

function getCachedCodes(sheetName) {
  var cache = CacheService.getScriptCache();
  var key = "codes_" + sheetName;
  var cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;

  var codes = getCodesFromSheet(sheet);
  cache.put(key, JSON.stringify(codes), 60);
  return codes;
}

// ═══════════════════════════════════════════
//  POST HANDLER (BATCH WRITE OPTIMIZED)
// ═══════════════════════════════════════════

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var code      = data.code;
    var day       = parseInt(data.day, 10);
    var startTime = data.start_time;
    var endTime   = data.end_time;
    var sheetName = data.sheet_name;

    // Validation
    if (!code) return jsonResponse({ status: "error", message: "Activity code is required" });
    if (!day || day < 1 || day > 31) return jsonResponse({ status: "error", message: "Day must be between 1 and 31" });
    if (!startTime || !endTime) return jsonResponse({ status: "error", message: "Start and end time required" });
    if (startTime >= endTime) return jsonResponse({ status: "error", message: "Start must be before end" });

    // Get sheet
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getActiveSheet();
    if (!sheet) return jsonResponse({ status: "error", message: "Sheet not found: " + sheetName });

    // Validate code against sheet's legend
    var sheetCodes = getCachedCodes(sheetName || sheet.getName());
    if (!sheetCodes) return jsonResponse({ status: "error", message: "Could not read codes from sheet" });

    var codeInfo = null;
    for (var i = 0; i < sheetCodes.length; i++) {
      if (sheetCodes[i].code === code) { codeInfo = sheetCodes[i]; break; }
    }
    if (!codeInfo) return jsonResponse({ status: "error", message: "Code '" + code + "' not valid for this sheet" });

    // Compute range
    var col = getColumnForDay(day);
    var startRow = getRowForTime(startTime);
    var endRow = getRowForTime(endTime);
    if (startRow === -1 || endRow === -1) return jsonResponse({ status: "error", message: "Invalid time range" });

    var numRows = endRow - startRow + 1;

    // BATCH READ: Read all existing values at once
    var range = sheet.getRange(startRow, col, numRows, 1);
    var existingValues = range.getValues();

    // Prepare batch arrays
    var newValues = [];
    var newBgColors = [];
    var newFontColors = [];
    var filled = 0;
    var skipped = 0;

    for (var r = 0; r < numRows; r++) {
      var current = existingValues[r][0];
      if (current !== "" && current !== null && current !== undefined) {
        // Keep existing value
        newValues.push([current]);
        newBgColors.push([null]); // Will be set individually below
        newFontColors.push([null]);
        skipped++;
      } else {
        newValues.push([code]);
        newBgColors.push([codeInfo.color]);
        newFontColors.push([codeInfo.fontColor]);
        filled++;
      }
    }

    if (filled > 0) {
      // BATCH WRITE: Set all values at once
      range.setValues(newValues);

      // Apply formatting cell-by-cell only for new cells (batch bg/font doesn't skip)
      for (var r = 0; r < numRows; r++) {
        if (newBgColors[r][0] !== null) {
          var cell = sheet.getRange(startRow + r, col);
          cell.setBackground(newBgColors[r][0]);
          cell.setFontColor(newFontColors[r][0]);
          cell.setHorizontalAlignment("center");
          cell.setFontWeight("bold");
          cell.setFontSize(9);
        }
      }

      // Invalidate progress cache for this sheet+day
      var cache = CacheService.getScriptCache();
      cache.remove("progress_" + (sheetName || sheet.getName()) + "_" + day);
    }

    return jsonResponse({
      status: "success",
      message: "Filled " + filled + " slot(s), skipped " + skipped + " occupied slot(s).",
      filled: filled,
      skipped: skipped,
    });

  } catch (err) {
    return jsonResponse({ status: "error", message: "Server error: " + err.message });
  }
}

// ═══════════════════════════════════════════
//  GET HANDLER
// ═══════════════════════════════════════════

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;

  // ── Sheet names (cached) ──────────────────
  if (action === "getSheets") {
    return jsonResponse({ status: "ok", sheets: getCachedSheetNames() });
  }

  // ── Codes for sheet (cached) ──────────────
  if (action === "getCodes") {
    var sheetParam = e.parameter.sheet;
    if (!sheetParam) return jsonResponse({ status: "error", message: "Missing 'sheet' parameter" });

    var codes = getCachedCodes(sheetParam);
    if (codes === null) return jsonResponse({ status: "error", message: "Sheet not found: " + sheetParam });

    return jsonResponse({ status: "ok", sheet: sheetParam, codes: codes });
  }

  // ── Day progress (cached 30s) ─────────────
  if (action === "getDayProgress") {
    var pSheet = e.parameter.sheet;
    var pDay = parseInt(e.parameter.day, 10);
    if (!pSheet || !pDay || pDay < 1 || pDay > 31) {
      return jsonResponse({ status: "error", message: "Invalid sheet/day" });
    }

    var cache = CacheService.getScriptCache();
    var cacheKey = "progress_" + pSheet + "_" + pDay;
    var cached = cache.get(cacheKey);
    if (cached) return jsonResponse(JSON.parse(cached));

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(pSheet);
    if (!sheet) return jsonResponse({ status: "error", message: "Sheet not found" });

    var col = getColumnForDay(pDay);
    var allTimes = generateTimeSlots();
    var totalSlots = allTimes.length;
    var MAX_WORK_SLOTS = 50;

    // BATCH READ: values + backgrounds
    var range = sheet.getRange(2, col, totalSlots, 1);
    var values = range.getValues();
    var backgrounds = range.getBackgrounds();
    var filled = 0;
    var filledSlots = [];
    for (var i = 0; i < values.length; i++) {
      var val = values[i][0];
      if (val !== "" && val !== null) {
        filled++;
        filledSlots.push({
          time: allTimes[i],
          code: String(val),
          color: backgrounds[i][0],
        });
      }
    }

    var result = {
      status: "ok",
      sheet: pSheet,
      day: pDay,
      filled: filled,
      total: MAX_WORK_SLOTS,
      percentage: Math.min(Math.round((filled / MAX_WORK_SLOTS) * 100), 100),
      filledSlots: filledSlots,
    };

    cache.put(cacheKey, JSON.stringify(result), 30);
    return jsonResponse(result);
  }

  // ── Health check ──────────────────────────
  return jsonResponse({ status: "ok", message: "AP&M Activity Tracker API", timestamp: new Date().toISOString() });
}

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
