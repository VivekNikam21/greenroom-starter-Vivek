// lib/llmCache.ts
//
// Disk-backed cache for LLM responses, keyed by content hash.
//
// Why: every parse call costs ~$0.002 and takes 5-12 seconds. Caching makes the
// dev loop instant and lets evaluators run the demo without an API key — we
// commit the cached responses for our demo shows to the repo.
//
// Cache key strategy: sha256 of the trimmed deal text. Identical input always
// produces the same cache hit. Any change to the deal text — even whitespace
// after trimming — is a cache miss and re-calls the API.

import { createHash } from "crypto";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const CACHE_DIR = join(process.cwd(), "data", "parsed-deals");

/** 16-char hex prefix of the sha256 — long enough to avoid collisions in our scale. */
export function hashDealText(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

export async function getCached<T>(hash: string): Promise<T | null> {
  const path = join(CACHE_DIR, `${hash}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setCached<T>(hash: string, value: T): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, `${hash}.json`);
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}