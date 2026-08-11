// ShiftTemplate.startTime/endTime (and <input type="time"> values) are
// stored/edited as 24-hour "HH:MM" strings — this is purely for display.
export function formatTime12h(value: string): string {
  const [hourStr, minuteStr] = value.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}
