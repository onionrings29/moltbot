export type ChunkingConfig = {
  enabled?: boolean;
  markers?: string[];
  minChunkSize?: number;
};

const DEFAULT_MARKERS = ["[MSG]", "<nl>"] as const;
// Keep minChunkSize very low - trust the LLM's judgment on where to split.
// This only prevents truly degenerate single-char fragments.
const DEFAULT_MIN_CHUNK_SIZE = 3;

export function parseChunkMarkers(config?: ChunkingConfig): string[] {
  if (!config?.enabled) return [];
  return config.markers && config.markers.length > 0 ? [...config.markers] : [...DEFAULT_MARKERS];
}

export function splitByChunkMarkers(
  text: string,
  markers: string[],
  opts?: { minChunkSize?: number },
): string[] {
  if (!text || markers.length === 0) return [text];

  const minChunkSize = opts?.minChunkSize ?? DEFAULT_MIN_CHUNK_SIZE;

  // Escape markers for regex (they may contain special chars)
  const escapedMarkers = markers.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?:${escapedMarkers.join("|")})`, "g");

  // Split on markers, removing them
  const parts = text.split(pattern).map((p) => p.trim());

  // Filter out empty parts
  const nonEmpty = parts.filter((p) => p.length > 0);

  if (nonEmpty.length === 0) return [text];
  if (nonEmpty.length === 1) return [stripTrailingPeriod(nonEmpty[0])];

  // Merge chunks that are too small
  const merged: string[] = [];
  let current = "";

  for (const part of nonEmpty) {
    const candidate = current ? `${current}\n\n${part}` : part;

    if (current.length > 0 && candidate.length < minChunkSize) {
      // Merge with previous
      current = candidate;
    } else {
      // Emit previous if any
      if (current) merged.push(stripTrailingPeriod(current));
      current = part;
    }
  }

  if (current) merged.push(stripTrailingPeriod(current));

  return merged.length > 0 ? merged : [text];
}

/**
 * Strip only trailing periods from text for casual texting style.
 * Preserves other trailing punctuation like ?, !, etc.
 */
function stripTrailingPeriod(text: string): string {
  if (text.endsWith(".")) {
    return text.slice(0, -1);
  }
  return text;
}
