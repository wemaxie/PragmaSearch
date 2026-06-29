import {
  pipeline,
  env,
  type FeatureExtractionPipeline,
  type DataType,
} from "@huggingface/transformers";

// Let deploys bake/persist the model cache to a known directory (see Dockerfile).
if (process.env.PRAGMA_MODEL_CACHE) {
  env.cacheDir = process.env.PRAGMA_MODEL_CACHE;
}

/**
 * The embedding model. We start with all-MiniLM-L6-v2: 384-dim, ~23MB at q8,
 * symmetric (no query/document prefix needed) — the simplest model that proves
 * the magic. bge-small-en-v1.5 becomes the default in a later phase.
 */
export const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";

/** Quantization. q8 keeps the download small with negligible quality loss for this class of model. */
export const DEFAULT_DTYPE = "q8";

export interface EmbedderOptions {
  model?: string;
  dtype?: string;
  /** Called with HF Hub download progress events on first load. */
  onProgress?: (event: unknown) => void;
}

/**
 * Some embedding models require an instruction prefix to hit their trained
 * distribution. We key off the model name so index-time and query-time stay
 * consistent (the model is stored in the index meta).
 *   - e5 family: "query: " on queries, "passage: " on documents.
 *   - bge family: a query-only instruction; documents unprefixed.
 *   - all-MiniLM and friends: no prefix (symmetric).
 */
export function queryPrefix(model: string): string {
  if (/e5/i.test(model)) return "query: ";
  if (/bge/i.test(model)) return "Represent this sentence for searching relevant passages: ";
  return "";
}

export function docPrefix(model: string): string {
  if (/e5/i.test(model)) return "passage: ";
  return "";
}

export interface Embedder {
  model: string;
  dtype: string;
  /** Embedding dimension, discovered from the first batch. */
  dim: number;
  /** Embed a batch of texts into L2-normalized mean-pooled vectors. */
  embed(texts: string[]): Promise<number[][]>;
  /** Embed a single text. */
  embedOne(text: string): Promise<number[]>;
}

/**
 * Build an embedder backed by Transformers.js. On first use the model weights
 * download from the HF Hub and are cached on disk; subsequent runs are offline.
 */
export async function createEmbedder(opts: EmbedderOptions = {}): Promise<Embedder> {
  const model = opts.model ?? DEFAULT_MODEL;
  const dtype = opts.dtype ?? DEFAULT_DTYPE;

  const extractor = (await pipeline("feature-extraction", model, {
    dtype: dtype as DataType,
    progress_callback: opts.onProgress,
  })) as FeatureExtractionPipeline;

  let dim = 0;

  async function embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const vectors = output.tolist() as number[][];
    if (dim === 0 && vectors[0]) dim = vectors[0].length;
    return vectors;
  }

  async function embedOne(text: string): Promise<number[]> {
    const [vec] = await embed([text]);
    return vec;
  }

  return {
    model,
    dtype,
    get dim() {
      return dim;
    },
    embed,
    embedOne,
  };
}
