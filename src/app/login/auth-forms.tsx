import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { forgotPassword, googleLogin, login, signup } from "./actions";

export function AuthForms({
  mode,
  next,
}: {
  mode: "login" | "signup" | "forgot";
  next: string;
}) {
  return (
    <>
      <ActionForm
        action={
          mode === "signup"
            ? signup
            : mode === "forgot"
              ? forgotPassword
              : login
        }
        className="space-y-4"
      >
        <input type="hidden" name="next" value={next} />
        {mode === "signup" ? (
          <Field label="Name">
            <input
              name="displayName"
              autoComplete="name"
              required
              minLength={2}
              maxLength={60}
              className={inputClass}
            />
          </Field>
        ) : null}
        <Field label="Email">
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            className={inputClass}
          />
        </Field>
        {mode !== "forgot" ? (
          <Field
            label="Password"
            hint={mode === "signup" ? "Use 8–128 characters." : undefined}
          >
            <input
              name="password"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              required
              minLength={8}
              maxLength={128}
              className={inputClass}
            />
          </Field>
        ) : null}
        {mode === "signup" ? (
          <Field label="Confirm password">
            <input
              name="confirmation"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              className={inputClass}
            />
          </Field>
        ) : null}
        <SubmitButton pendingLabel="Please wait…" className="min-h-11 w-full">
          {mode === "signup"
            ? "Create account"
            : mode === "forgot"
              ? "Send reset link"
              : "Sign in"}
        </SubmitButton>
      </ActionForm>
      {mode !== "forgot" ? (
        <ActionForm action={googleLogin}>
          <input type="hidden" name="next" value={next} />
          <SubmitButton
            variant="secondary"
            pendingLabel="Connecting…"
            className="min-h-11 w-full"
          >
            Continue with Google
          </SubmitButton>
        </ActionForm>
      ) : null}
      <nav
        aria-label="Account options"
        className="flex flex-wrap gap-4 text-sm"
      >
        {mode !== "login" ? (
          <Link className="py-2 underline" href="/login">
            Sign in
          </Link>
        ) : null}
        {mode !== "signup" ? (
          <Link className="py-2 underline" href="/login?mode=signup">
            Create account
          </Link>
        ) : null}
        {mode !== "forgot" ? (
          <Link className="py-2 underline" href="/login?mode=forgot">
            Forgot password?
          </Link>
        ) : null}
      </nav>
    </>
  );
}
