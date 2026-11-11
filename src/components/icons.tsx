import type { CSSProperties } from "react";
export type IconName = "grid" | "compass" | "shield" | "calendar" | "users" | "bolt" | "award" | "arrow";
const paths: Record<IconName, string> = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  compass: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M16 8l-3 5-5 3 3-5z",
  shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
  calendar: "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87",
  bolt: "M13 2L3 14h8l-1 8 11-13h-8z",
  award: "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M8 12l-2 9 6-3 6 3-2-9",
  arrow: "M5 12h14 M14 7l5 5-5 5",
};
export function Icon({ name, className = "", style }: { name: IconName; className?: string; style?: CSSProperties }) {
  return <svg className={className} style={style} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
export function BrandMark() {
  return <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true"><rect width="34" height="34" rx="10" fill="currentColor"/><path d="M22 10a9 9 0 1 0 0 14M25 13a5 5 0 1 0 0 8" stroke="#08110b" strokeWidth="2.4" strokeLinecap="round"/><circle cx="24" cy="10" r="2" fill="#08110b"/></svg>;
}
