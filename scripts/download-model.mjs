/**
 * Downloads the semantic-search embedding model (Model2Vec potion-base-8M,
 * MIT licence) into .models/potion-base-8M, pinned to an exact revision and
 * verified with SHA-256, so a tampered or changed file is rejected.
 *
 *   npm run models:download
 *
 * Safe to re-run: files that already match their checksum are skipped.
 * Without the model, search falls back to lexical hash embeddings.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO = "minishlab/potion-base-8M";
const REVISION = "bf8b056651a2c21b8d2565580b8569da283cab23";
const TARGET = path.resolve(process.env.EMBEDDINGS_MODEL_DIR ?? ".models/potion-base-8M");

const FILES = {
  "config.json": "2a6ac0e9aaa356a68a5688070db78fc3a464fefe85d2f06a1905ce3718687553",
  "tokenizer.json": "e67e803f624fb4d67dea1c730d06e1067e1b14d830e2c2202569e3ef0f70bb50",
  "tokenizer_config.json": "6725995e3ab3039857ff5bd99178a7cdf42863abb04449e7bb31feb1f55fe567",
  "model.safetensors": "f65d0f325faadc1e121c319e2faa41170d3fa07d8c89abd48ca5358d9a223de2",
};

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

await mkdir(TARGET, { recursive: true });
for (const [file, expected] of Object.entries(FILES)) {
  const destination = path.join(TARGET, file);
  try {
    if (sha256(await readFile(destination)) === expected) {
      console.log(`ok       ${file}`);
      continue;
    }
  } catch {
    // not downloaded yet
  }

  const url = `https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed for ${file}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== expected) throw new Error(`checksum mismatch for ${file}: expected ${expected}, got ${actual}`);

  await writeFile(`${destination}.part`, data);
  await rename(`${destination}.part`, destination);
  console.log(`fetched  ${file} (${(data.length / 1e6).toFixed(1)} MB)`);
}
console.log(`Model ready in ${path.relative(process.cwd(), TARGET)}`);
