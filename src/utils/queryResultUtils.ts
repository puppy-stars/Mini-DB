import { QueryResult } from '../models/types';

function tryParseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

export function extractTotalRows(result: QueryResult): number | undefined {
  if (!result.rows || result.rows.length === 0) {
    return undefined;
  }

  const row = result.rows[0] as Record<string, unknown>;
  const preferredKeys = ['total', 'count', 'row_count', 'cnt'];
  const rowEntries = Object.entries(row);

  for (const key of preferredKeys) {
    const matched = rowEntries.find(([k]) => k.toLowerCase() === key);
    if (!matched) {
      continue;
    }
    const parsed = tryParseNumber(matched[1]);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  for (const [, value] of rowEntries) {
    const parsed = tryParseNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}
