"use client";
import { buttonClass } from "@/components/ui";
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`${buttonClass()} mt-6 print:hidden`}
    >
      Print certificate
    </button>
  );
}
