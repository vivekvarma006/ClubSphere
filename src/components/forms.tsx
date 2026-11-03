"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/action-state";
import { buttonClass, cx, type ButtonVariant } from "./ui";

/**
 * A form bound to a Server Action that returns ActionState. Shows the
 * action's success or error message under the fields; works without
 * JavaScript too (progressive enhancement).
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      {state ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={cx("mt-2 text-sm", state.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  pendingLabel,
  className,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cx(buttonClass(variant, size), className)}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
