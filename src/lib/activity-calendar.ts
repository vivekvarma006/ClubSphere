export interface ActivityDay { date: string; attendance: number; tasks: number; solves: number }
export const activityCount = (day: ActivityDay) => day.attendance + day.tasks + day.solves;
export function activitySummary(days: ActivityDay[]) {
  let total = 0, activeDays = 0, longestStreak = 0, streak = 0;
  for (const day of days) {
    const count = activityCount(day);
    total += count;
    if (count) { activeDays++; streak++; longestStreak = Math.max(streak, longestStreak); }
    else streak = 0;
  }
  return { total, activeDays, longestStreak };
}

/** Sunday-first columns. Leading blanks and future days are never activity. */
export function calendarCells(days: ActivityDay[]) {
  const first = days[0];
  if (!first) return [];
  const offset = new Date(`${first.date}T00:00:00Z`).getUTCDay();
  const cells: (ActivityDay | null)[] = [...Array<null>(offset).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return cells;
}
