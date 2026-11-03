import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { verifyCertificate } from "@/server/services/certificates";
import { formatDate } from "@/components/ui";
import { PrintButton } from "./print-button";
export const metadata = {
  title: "Certificate verification · ClubSphere",
  robots: { index: false, follow: false },
};
export default async function VerifyPage({
  params,
}: PageProps<"/verify/[code]">) {
  const { code } = await params;
  const certificate = await verifyCertificate(await getDb(), code);
  if (!certificate) notFound();
  return (
    <main className="mx-auto my-12 w-full max-w-3xl px-6">
      <article className="rounded-xl border-2 border-zinc-300 p-10 text-center print:border-black">
        <p className="text-sm uppercase tracking-widest">
          {certificate.organization_name}
        </p>
        <h1 className="my-8 text-3xl font-semibold">
          Certificate of participation
        </h1>
        <p>This certifies that</p>
        <p className="my-4 text-3xl font-semibold">
          {certificate.recipient_name}
        </p>
        <p>attended</p>
        <p className="my-4 text-xl">{certificate.event_title}</p>
        <p className="mt-8 text-sm">
          Issued {formatDate(certificate.issued_at)} · Verified by ClubSphere
        </p>
        <p className="mt-4 break-all font-mono text-xs">
          Verification code: {code}
        </p>
      </article>
      <PrintButton />
    </main>
  );
}
