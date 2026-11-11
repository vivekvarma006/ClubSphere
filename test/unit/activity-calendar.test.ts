import { describe, expect, it } from "vitest";
import { activityCount, activitySummary, calendarCells, type ActivityDay } from "@/lib/activity-calendar";
const day = (date: string, count: number): ActivityDay => ({ date, attendance: count, tasks: 0, solves: 0 });
describe("activity calendar", () => {
  it("places dates in Sunday-first weekly columns without shifting month/leap-day boundaries", () => {
    const days = [day("2024-02-28",1),day("2024-02-29",2),day("2024-03-01",0)];
    const cells = calendarCells(days);
    expect(cells).toHaveLength(7);
    expect(cells.slice(0,3)).toEqual([null,null,null]);
    expect(cells.slice(3,6)).toEqual(days);
    expect(cells[6]).toBeNull();
    expect(calendarCells([day("2026-11-08",1)])[0]?.date).toBe("2026-11-08");
  });
  it("counts source actions once and resets streaks on empty days", () => {
    expect(activityCount({date:"2026-11-01",attendance:1,tasks:2,solves:3})).toBe(6);
    expect(activitySummary([day("2026-11-01",2),day("2026-11-02",1),day("2026-11-03",0),day("2026-11-04",4)])).toEqual({total:7,activeDays:3,longestStreak:2});
    expect(activitySummary([])).toEqual({total:0,activeDays:0,longestStreak:0});
    expect(calendarCells([])).toEqual([]);
  });
});
