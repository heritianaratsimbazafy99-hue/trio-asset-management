function parseDateParts(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  const [yearText, monthText, dayText] = text.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { year, month, day };
}

export function parseDueDateEndOfDayMs(dueDate) {
  const parts = parseDateParts(dueDate);
  if (!parts) return null;

  const localEndOfDay = new Date(
    parts.year,
    parts.month - 1,
    parts.day,
    23,
    59,
    59,
    999
  ).getTime();

  return Number.isFinite(localEndOfDay) ? localEndOfDay : null;
}

export function isMaintenanceOverdue(dueDate, nowMs = Date.now()) {
  const dueMs = parseDueDateEndOfDayMs(dueDate);
  if (!dueMs) return false;
  return dueMs < nowMs;
}

export function computeMaintenanceSlaStatus(item, nowMs = Date.now()) {
  if (!item) return "SANS_DELAI";
  if (item.is_completed || String(item.status || "").toUpperCase() === "TERMINEE") {
    return "TERMINEE";
  }
  if (!item.due_date) return "SANS_DELAI";

  const dueMs = parseDueDateEndOfDayMs(item.due_date);
  if (!dueMs) return "SANS_DELAI";
  if (dueMs < nowMs) return "EN_RETARD";

  const oneDayMs = 24 * 60 * 60 * 1000;
  if (dueMs - nowMs <= 2 * oneDayMs) return "A_RISQUE";

  return "OK";
}
