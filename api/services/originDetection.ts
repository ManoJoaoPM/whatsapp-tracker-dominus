export function findFirstStringByKey(input: unknown, key: string, maxDepth = 7): string | null {
  const seen = new Set<unknown>();

  function walk(value: unknown, depth: number): string | null {
    if (depth > maxDepth) return null;
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return null;
    if (seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    const record = value as Record<string, unknown>;

    const direct = record[key];
    if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim();

    for (const child of Object.values(record)) {
      const found = walk(child, depth + 1);
      if (found) return found;
    }

    return null;
  }

  return walk(input, 0);
}

export function findFirstObjectByKey(input: unknown, key: string, maxDepth = 7): Record<string, unknown> | null {
  const seen = new Set<unknown>();

  function walk(value: unknown, depth: number): Record<string, unknown> | null {
    if (depth > maxDepth) return null;
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return null;
    if (seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    const record = value as Record<string, unknown>;

    const direct = record[key];
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }

    for (const child of Object.values(record)) {
      const found = walk(child, depth + 1);
      if (found) return found;
    }

    return null;
  }

  return walk(input, 0);
}

export function extractMetaExternalAdReply(msg: unknown): Record<string, unknown> | null {
  return findFirstObjectByKey(msg, 'externalAdReply');
}

export function extractMetaCtwaClidFromEvolutionMessage(msg: unknown): string | null {
  return findFirstStringByKey(msg, 'ctwaClid');
}

export function extractMetaSourceIdFromEvolutionMessage(msg: unknown): string | null {
  return findFirstStringByKey(msg, 'sourceId');
}

