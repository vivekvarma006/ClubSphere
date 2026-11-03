import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { VerifiedActor } from "@/server/auth/actor";
import { assertPermission, loadOrgAccess } from "@/server/authz/org-access";
import { documents, type DocumentSourceType } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { queryRows, withUserContext } from "@/server/db/user-context";
import { handleServiceError } from "@/server/errors";
import { chunkDocument } from "@/server/search/chunking";
import { getEmbedder, toVectorLiteral } from "@/server/search/embeddings";
import { OrganizationSlug } from "@/server/validation/inputs";

/**
 * Club knowledge base: documents are chunked and embedded here (in the
 * application), then stored with private.save_document(). Search embeds the
 * query with the same model and calls private.search_documents(), which
 * fuses pgvector similarity with full-text ranking.
 */

async function run<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw handleServiceError(operation, error);
  }
}

export const SOURCE_TYPES = ["event_doc", "guide", "writeup", "feedback", "minutes"] as const;

export interface SearchHit {
  documentId: string;
  title: string;
  sourceType: DocumentSourceType;
  snippet: string;
  semanticSimilarity: number | null;
  keywordRank: number | null;
  score: number;
}

const SearchRow = z.object({
  document_id: z.uuid(),
  title: z.string(),
  source_type: z.enum(SOURCE_TYPES),
  snippet: z.string(),
  semantic_similarity: z.number().nullable(),
  keyword_rank: z.number().nullable(),
  score: z.number(),
});

export async function searchKnowledgeBase(
  db: Database,
  actor: VerifiedActor,
  input: { organizationSlug: string; query: string },
): Promise<{ hits: SearchHit[]; model: string }> {
  return run("kb.search", async () => {
    const slug = OrganizationSlug.parse(input.organizationSlug);
    const query = z.string().trim().min(2).max(300).parse(input.query);
    const embedder = await getEmbedder();
    const [vector] = await embedder.embed([query]);
    if (!vector) throw new Error("embedding failed");

    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, slug);
      const rows = await queryRows(
        tx,
        sql`select document_id, title, source_type, snippet, semantic_similarity, keyword_rank, score
              from private.search_documents(${access.organization.id}::uuid,
                                            ${toVectorLiteral(vector)}::extensions.vector,
                                            ${query}, ${embedder.model}, 10)`,
        SearchRow,
      );
      return {
        model: embedder.model,
        hits: rows.map((r) => ({
          documentId: r.document_id,
          title: r.title,
          sourceType: r.source_type,
          snippet: r.snippet,
          semanticSimilarity: r.semantic_similarity,
          keywordRank: r.keyword_rank,
          score: r.score,
        })),
      };
    });
  });
}

export async function listDocuments(db: Database, actor: VerifiedActor, organizationSlug: string) {
  return run("kb.list", async () => {
    const slug = OrganizationSlug.parse(organizationSlug);
    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, slug);
      return tx
        .select({
          id: documents.id,
          title: documents.title,
          sourceType: documents.sourceType,
          visibility: documents.visibility,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .where(eq(documents.organizationId, access.organization.id))
        .orderBy(desc(documents.createdAt))
        .limit(100);
    });
  });
}

export async function getDocument(db: Database, actor: VerifiedActor, organizationSlug: string, documentId: string) {
  return run("kb.get", async () => {
    const slug = OrganizationSlug.parse(organizationSlug);
    const id = z.uuid().parse(documentId);
    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, slug);
      const [doc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, id), eq(documents.organizationId, access.organization.id)));
      return doc ?? null;
    });
  });
}

const SaveDocumentInput = z.object({
  organizationSlug: OrganizationSlug,
  title: z.string().trim().min(3).max(200),
  sourceType: z.enum(SOURCE_TYPES),
  body: z.string().trim().min(1).max(50000),
  visibility: z.enum(["members", "officers"]).default("members"),
  eventId: z.uuid().optional(),
});

export async function saveDocument(
  db: Database,
  actor: VerifiedActor,
  input: z.input<typeof SaveDocumentInput>,
): Promise<{ documentId: string }> {
  return run("kb.save", async () => {
    const doc = SaveDocumentInput.parse(input);
    const chunks = chunkDocument(doc.title, doc.body);
    const embedder = await getEmbedder();
    const vectors = await embedder.embed(chunks);
    const payload = chunks.map((content, i) => ({ content, embedding: vectors[i] }));

    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, doc.organizationSlug);
      assertPermission(access, "document.manage");
      const [row] = await queryRows(
        tx,
        sql`select private.save_document(${access.organization.id}::uuid, null, ${doc.title}, ${doc.sourceType},
                                         ${doc.eventId ?? null}::uuid, ${doc.body}, ${doc.visibility},
                                         ${embedder.model}, ${JSON.stringify(payload)}::jsonb) as v`,
        z.object({ v: z.uuid() }),
      );
      if (!row) throw new Error("save_document returned no row");
      return { documentId: row.v };
    });
  });
}
