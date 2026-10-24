import Link from "next/link";
import { Suspense } from "react";

const MESSAGES: Record<string, string> = {
  provider: "The sign-in provider did not complete the sign-in.",
  missing_code: "The sign-in link is incomplete.",
  exchange_failed: "This sign-in link has already been used or has expired.",
  invalid_link: "This link is not valid.",
  link_expired: "This link has expired or has already been used.",
};
const FALLBACK = "Something went wrong while signing you in.";

type SearchParams = PageProps<"/auth/error">["searchParams"];

async function Reason({ searchParams }: { searchParams: SearchParams }) {
  const { reason } = await searchParams;
  const message = typeof reason === "string" ? MESSAGES[reason] : undefined;
  return <p className="text-zinc-600">{message ?? FALLBACK}</p>;
}

export default function AuthErrorPage({ searchParams }: PageProps<"/auth/error">) {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-2xl font-semibold">We couldn&apos;t sign you in</h1>
      <Suspense fallback={<p className="text-zinc-600">{FALLBACK}</p>}>
        <Reason searchParams={searchParams} />
      </Suspense>
      <Link className="font-medium underline" href="/">
        Back to the start
      </Link>
    </main>
  );
}
