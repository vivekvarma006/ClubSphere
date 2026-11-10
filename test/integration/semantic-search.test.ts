import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, expect, it, vi } from "vitest";
import { verifiedActor } from "@/server/auth/actor";
import * as schema from "@/server/db/schema";
import { getEmbedder } from "@/server/search/embeddings";
import { saveDocument, searchKnowledgeBase } from "@/server/services/knowledge-base";
import { freshWorld } from "../db/fixtures";

afterEach(() => vi.unstubAllEnvs());
it.skipIf(!existsSync(".models/potion-base-8M/model.safetensors"))(
  "uses the installed semantic model and pgvector to rank related content above unrelated documents",
  async () => {
    vi.stubEnv("AUTH_MODE", "demo");
    vi.stubEnv("EMBEDDINGS_PROVIDER", "static");
    const embedder = await getEmbedder();
    expect(embedder.model).toBe("minishlab/potion-base-8M");
    const [vector] = await embedder.embed(["stealing session cookies with javascript"]);
    expect(vector).toHaveLength(256);
    expect(Math.hypot(...vector!)).toBeCloseTo(1, 5);
    const { db: pg, w } = await freshWorld();
    try {
      const db = drizzle(pg, { schema });
      const officer = verifiedActor(w.officerA, null);
      const member = verifiedActor(w.memberA, null);
      await saveDocument(db, officer, { organizationSlug: w.orgA.slug,
        title: "Cross-site scripting walkthrough", sourceType: "guide", visibility: "members",
        body: "An attacker injects JavaScript into a vulnerable web page. This cross-site scripting attack can steal session cookies from the victim's browser and hijack their account." });
      await saveDocument(db, officer, { organizationSlug: w.orgA.slug,
        title: "Gardening club schedule", sourceType: "guide", visibility: "members",
        body: "Water the flower beds and plant tomatoes in the community garden during spring." });
      const result = await searchKnowledgeBase(db, member, {
        organizationSlug: w.orgA.slug, query: "stealing session cookies with javascript",
      });
      expect(result.model).toBe("minishlab/potion-base-8M");
      expect(result.hits[0]?.title).toBe("Cross-site scripting walkthrough");
      expect(result.hits[0]?.semanticSimilarity).toBeGreaterThan(0.3);
      const otherClub = await searchKnowledgeBase(db, verifiedActor(w.officerB, null), {
        organizationSlug: w.orgB.slug, query: "stealing session cookies with javascript",
      });
      expect(otherClub.hits).toEqual([]);
    } finally { await pg.close(); }
  },
);
