"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { activityCount, activitySummary, calendarCells, type ActivityDay } from "@/lib/activity-calendar";
import { Card, cx } from "@/components/ui";

const levels = ["heat-0", "heat-1", "heat-2", "heat-3", "heat-4"];
const dateLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function ActivityHeatmap({ days, club = false }: { days: ActivityDay[]; club?: boolean }) {
  const id = useId();
  const [weeks, setWeeks] = useState(52);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = scroll.current;
    if (!viewport) return;
    const showRecent = () => { viewport.scrollLeft = viewport.scrollWidth; };
    showRecent();
    const observer = new ResizeObserver(showRecent);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [weeks, days]);
  const [selected, setSelected] = useState<string | null>(null);
  const visible = days.slice(-(weeks === 52 ? 365 : weeks * 7));
  const cells = calendarCells(visible);
  const summary = activitySummary(visible);
  const current = visible.find(day => day.date === selected) ?? visible.at(-1);
  const title = club ? "Club activity" : "Contribution activity";
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (!delta) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(visible.length - 1, index + delta));
    const day = visible[target];
    if (!day) return;
    setSelected(day.date);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-day-index="${target}"]`)?.focus();
  }
  return <Card className="heatmap-card">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="eyebrow mb-1">Consistency, one day at a time</p>
        <h2 className="text-lg font-semibold" id={`${id}-title`}>{title}</h2>
        <p className="mt-1 text-sm text-zinc-400">{summary.total} contributions in the last {visible.length} days</p>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <span className="sr-only">Activity period</span>
        <select className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-200" value={weeks}
          onChange={event => { setWeeks(Number(event.target.value)); setSelected(null); }}>
          <option value={52}>Last 12 months</option><option value={26}>Last 6 months</option><option value={13}>Last 3 months</option>
        </select>
      </label>
    </div>
    {days.length ? <>
      <div ref={scroll} className="heatmap-scroll" role="region" aria-label={`${title} calendar. Scroll horizontally to view all weeks.`} tabIndex={0}>
        <div className="heatmap-calendar" style={{ minWidth: `${cells.length / 7 * 14 + 34}px` }}>
          <div className="heatmap-months" aria-hidden="true">
            {Array.from({ length: cells.length / 7 }, (_, week) => {
              const day = cells.slice(week * 7, week * 7 + 7).find(day => day && (week === 0 || day.date.endsWith("-01")));
              return <span key={week}>{day ? new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }) : ""}</span>;
            })}
          </div>
          <div className="heatmap-body">
            <div className="heatmap-weekdays" aria-hidden="true"><span /><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /></div>
            <div className="heatmap-grid" role="group" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`}>
              {cells.map((day, cellIndex) => {
                if (!day) return <span key={`blank-${cellIndex}`} />;
                const count = activityCount(day), index = visible.indexOf(day);
                const label = `${dateLabel(day.date)}: ${count} contributions; ${day.attendance} check-ins, ${day.tasks} completed tasks, ${day.solves} CTF solves`;
                return <button type="button" key={day.date} data-day-index={index} data-count={count}
                  className={cx("heatmap-cell", levels[Math.min(4, count)], current?.date === day.date && "heatmap-selected")}
                  tabIndex={current?.date === day.date ? 0 : -1} aria-label={label} aria-pressed={selected === day.date}
                  title={label} onClick={() => setSelected(day.date)} onKeyDown={event => move(event, index)} />;
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
        <p id={`${id}-help`}>Select a day for details. Use arrow keys to explore. Dates in UTC.</p>
        <div className="flex items-center gap-1.5" aria-label="Intensity: zero, one, two, three, four or more contributions">
          <span className="mr-1">Less</span>{levels.map(level => <span key={level} className={`heatmap-cell ${level}`} aria-hidden="true" />)}<span className="ml-1">More</span>
        </div>
      </div>
      <div className="heatmap-detail mt-5" role="status" aria-live="polite" aria-atomic="true">
        {current ? <><label className="flex items-center gap-2"><span className="sr-only">Activity date</span>
          <input type="date" className="min-h-10 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200" value={current.date}
            min={visible[0]?.date} max={visible.at(-1)?.date}
            onChange={event => { if (visible.some(day => day.date === event.target.value)) setSelected(event.target.value); }} />
          <span className="sr-only">{dateLabel(current.date)}</span></label><span className="self-center">{current.attendance} check-ins · {current.tasks} tasks completed · {current.solves} CTF solves</span></> : null}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-4 border-t border-zinc-800 pt-5">
        {[["Contributions", summary.total], ["Active days", summary.activeDays], ["Longest streak", `${summary.longestStreak} ${summary.longestStreak === 1 ? "day" : "days"}`]].map(([label, value]) =>
          <div key={label}><p className="text-lg font-semibold tabular-nums text-zinc-100">{value}</p><p className="mt-1 text-xs text-zinc-400">{label}</p></div>)}
      </div>
    </> : <p className="text-sm text-zinc-400">No activity data available.</p>}
    <p className="mt-4 text-xs text-zinc-500">Check-ins, completed volunteer tasks and CTF solves{club ? " visible to your club permissions" : " across your active clubs"}. Certificates are excluded to avoid counting attendance twice.</p>
  </Card>;
}
