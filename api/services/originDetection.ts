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

/**
 * WhatsApp Cloud API puts the ad data in `messages[].referral`
 * (source_id, headline, body, media_type, thumbnail_url, image_url, source_url, ctwa_clid).
 * Normalised to the same shape Evolution uses for `externalAdReply`.
 */
export function extractMetaReferralFromCloudMessage(msg: unknown): Record<string, unknown> | null {
  const referral = findFirstObjectByKey(msg, 'referral');
  if (!referral) return null;
  return {
    title: referral.headline,
    body: referral.body,
    mediaType: referral.media_type,
    thumbnailUrl: referral.thumbnail_url || referral.image_url,
    sourceUrl: referral.source_url,
  };
}

export function extractMetaCtwaClidFromCloudMessage(msg: unknown): string | null {
  return findFirstStringByKey(msg, 'ctwa_clid');
}

export function extractMetaSourceIdFromCloudMessage(msg: unknown): string | null {
  return findFirstStringByKey(msg, 'source_id');
}
