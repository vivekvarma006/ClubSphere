import { saveDocumentAction } from "@/app/actions";
import { load, pageContext } from "@/app/page-utils";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, EmptyState, Field, Notice, PageHeader, buttonClass, formatDate, inputClass } from "@/components/ui";
import { getClubContext } from "@/server/services/clubs";
import { SOURCE_TYPES, listDocuments, searchKnowledgeBase } from "@/server/services/knowledge-base";

const SOURCE_LABEL: Record<(typeof SOURCE_TYPES)[number], string> = {
  event_doc: "Event document",
  guide: "Guide",
  writeup: "Write-up",
  feedback: "Feedback",
  minutes: "Minutes",
};

const EXAMPLES = ["stealing session cookies with javascript", "how do I get past a login page without a password", "getting root on a linux box"];

export default async function SearchPage({ params, searchParams }: PageProps<"/o/[slug]/search">) {
  const { slug } = await params;
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const { actor, db } = await pageContext();
  const club = await load(getClubContext(db, actor, slug));
  const [results, documents] = await Promise.all([
    query.length >= 2 ? searchKnowledgeBase(db, actor, { organizationSlug: slug, query }) : Promise.resolve(null),
    listDocuments(db, actor, slug),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge base"
        description="Hybrid search: pgvector similarity on 256-dimensional embeddings (meaning) fused with PostgreSQL full-text search (exact words)."
      />
      <form className="flex gap-2" action={`/o/${slug}/search`}>
        <input name="q" defaultValue={query} placeholder="Ask in your own words..." className={inputClass} aria-label="Search" />
        <button type="submit" className={buttonClass("primary")}>
          Search
        </button>
      </form>
      {!query ? (
        <p className="text-sm text-zinc-500">
          Try:{" "}
          {EXAMPLES.map((e, i) => (
            <span key={e}>
              {i > 0 ? " · " : ""}
              <a className="underline" href={`/o/${slug}/search?q=${encodeURIComponent(e)}`}>
                {e}
              </a>
            </span>
          ))}
        </p>
      ) : null}

      {results ? (
        <Card>
          <CardTitle aside={<span className="text-xs text-zinc-500">embedding model: {results.model}</span>}>
            Results for &ldquo;{query}&rdquo;
          </CardTitle>
          {results.model === "hash-v1" ? (
            <div className="mb-3">
              <Notice>The semantic model is not installed, so matching is word-based. Run npm run models:download.</Notice>
            </div>
          ) : null}
          {results.hits.length === 0 ? (
            <EmptyState>No matching documents.</EmptyState>
          ) : (
            <ol className="space-y-4">
              {results.hits.map((h, i) => (
                <li key={h.documentId} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-zinc-400">{i + 1}.</span>
                    <span className="font-medium">{h.title}</span>
                    <Badge>{SOURCE_LABEL[h.sourceType]}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{h.snippet}...</p>
                  <p className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
                    <span>
                      meaning match:{" "}
                      <strong>{h.semanticSimilarity !== null ? `${Math.round(h.semanticSimilarity * 100)}%` : "below threshold"}</strong>
                    </span>
                    <span>
                      exact words: <strong>{h.keywordRank !== null ? "yes" : "no"}</strong>
                    </span>
                    <span>fused score: {h.score.toFixed(4)}</span>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Documents ({documents.length})</CardTitle>
          {documents.length === 0 ? (
            <EmptyState>No documents yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{d.title}</span>
                  <span className="flex gap-1">
                    {d.visibility === "officers" ? <Badge tone="amber">Officers only</Badge> : null}
                    <Badge>{SOURCE_LABEL[d.sourceType]}</Badge>
                    <span className="text-xs text-zinc-500">{formatDate(d.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {club.permissions.has("document.manage") ? (
          <Card>
            <CardTitle>Publish a document</CardTitle>
            <ActionForm action={saveDocumentAction.bind(null, slug)} className="space-y-3">
              <Field label="Title">
                <input name="title" required minLength={3} maxLength={200} className={inputClass} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Type">
                  <select name="sourceType" className={inputClass} defaultValue="guide">
                    {SOURCE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {SOURCE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Visible to">
                  <select name="visibility" className={inputClass} defaultValue="members">
                    <option value="members">All members</option>
                    <option value="officers">Officers only</option>
                  </select>
                </Field>
              </div>
              <Field label="Text" hint="Split into chunks and embedded when published.">
                <textarea name="body" required rows={6} maxLength={50000} className={inputClass} />
              </Field>
              <SubmitButton pendingLabel="Indexing...">Publish</SubmitButton>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
