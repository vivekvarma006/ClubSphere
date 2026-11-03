import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Tokenizer } from "@huggingface/tokenizers";
import { serverEnv } from "@/server/env";
import { log } from "@/server/log";

/**
 * Text -> 256-dimensional unit vectors for semantic search.
 *
 * StaticEmbedder (default): Model2Vec "potion-base-8M", a static embedding
 * model distilled from the BGE-base transformer. Every vocabulary token has
 * a learned 256-number vector; a text's embedding is the mean of its token
 * vectors, normalized to length 1. Pure TypeScript, no native code, ~30 MB
 * of weights downloaded once by `npm run models:download`.
 *
 * HashEmbedder (fallback and tests): feature hashing of words and word
 * pairs into 256 buckets. Lexical only (no notion of synonyms), but needs no
 * files. Used when the model is not installed or EMBEDDINGS_PROVIDER=hash.
 *
 * Vectors from different models are not comparable, so every stored chunk
 * records `embedding_model` and searches only compare like with like.
 */
export const EMBEDDING_DIMENSIONS = 256;

export interface Embedder {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

function normalize(vector: Float64Array): number[] {
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  return Array.from(vector, (v) => (norm > 0 ? v / norm : 0));
}

// ---------------------------------------------------------------------------
// Static (Model2Vec) embeddings
// ---------------------------------------------------------------------------

const MAX_TOKENS = 512;

export class StaticEmbedder implements Embedder {
  readonly model = "minishlab/potion-base-8M";

  private constructor(
    private readonly tokenizer: Tokenizer,
    private readonly matrix: Float32Array,
    private readonly unkId: number | undefined,
  ) {}

  static async load(directory: string): Promise<StaticEmbedder> {
    const [tokenizerJson, tokenizerConfig, weights] = await Promise.all([
      readFile(path.join(directory, "tokenizer.json"), "utf8"),
      readFile(path.join(directory, "tokenizer_config.json"), "utf8"),
      readFile(path.join(directory, "model.safetensors")),
    ]);

    // safetensors: 8-byte little-endian header length, JSON header, raw tensor data.
    const headerLength = Number(weights.readBigUInt64LE(0));
    const header = JSON.parse(weights.subarray(8, 8 + headerLength).toString("utf8")) as Record<
      string,
      { dtype: string; shape: number[]; data_offsets: [number, number] }
    >;
    const tensor = header.embeddings;
    if (!tensor || tensor.dtype !== "F32" || tensor.shape[1] !== EMBEDDING_DIMENSIONS) {
      throw new Error("unexpected embedding model format");
    }
    const start = 8 + headerLength + tensor.data_offsets[0];
    const bytes = weights.subarray(start, 8 + headerLength + tensor.data_offsets[1]);
    // Copy into an aligned buffer: Float32Array views need 4-byte alignment.
    const matrix = new Float32Array(bytes.byteLength / 4);
    new Uint8Array(matrix.buffer).set(bytes);

    const tokenizer = new Tokenizer(JSON.parse(tokenizerJson), JSON.parse(tokenizerConfig));
    return new StaticEmbedder(tokenizer, matrix, tokenizer.token_to_id("[UNK]"));
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const ids = this.tokenizer
        .encode(text, { add_special_tokens: false })
        .ids.filter((id) => id !== this.unkId)
        .slice(0, MAX_TOKENS);
      const sum = new Float64Array(EMBEDDING_DIMENSIONS);
      for (const id of ids) {
        const offset = id * EMBEDDING_DIMENSIONS;
        for (let d = 0; d < EMBEDDING_DIMENSIONS; d++) sum[d]! += this.matrix[offset + d]!;
      }
      return normalize(sum); // mean pooling then L2-normalize == normalize(sum)
    });
  }
}

// ---------------------------------------------------------------------------
// Hashing fallback
// ---------------------------------------------------------------------------

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export class HashEmbedder implements Embedder {
  readonly model = "hash-v1";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const features = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
      const vector = new Float64Array(EMBEDDING_DIMENSIONS);
      for (const feature of features) {
        const h = fnv1a(feature);
        vector[h % EMBEDDING_DIMENSIONS]! += (h & 0x100) === 0 ? 1 : -1;
      }
      return normalize(vector);
    });
  }
}

// ---------------------------------------------------------------------------

let embedderPromise: Promise<Embedder> | undefined;

async function createEmbedder(): Promise<Embedder> {
  const env = serverEnv();
  if (env.EMBEDDINGS_PROVIDER === "hash") return new HashEmbedder();
  try {
    return await StaticEmbedder.load(path.resolve(env.EMBEDDINGS_MODEL_DIR));
  } catch (error) {
    log.warn("search.embedding_model_unavailable", {
      reason: error instanceof Error ? error.message.slice(0, 120) : "unknown",
      fallback: "hash-v1",
    });
    return new HashEmbedder();
  }
}

/** The process-wide embedder (loaded once). */
export function getEmbedder(): Promise<Embedder> {
  embedderPromise ??= createEmbedder();
  return embedderPromise;
}

/** pgvector text format: "[0.1,0.2,...]". */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => (Number.isFinite(v) ? v.toFixed(6) : "0")).join(",")}]`;
}
