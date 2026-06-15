// Discovery — populate the Analyze form from the user's own Splunk so they pick
// real index/sourcetype/field names instead of guessing. All best-effort:
// returns empty lists on error (e.g. sample mode) so the form falls back to
// free text.
import { AGENT_URL } from "./config";

async function safeGet<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${AGENT_URL}${path}`, { cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export async function getIndexes(): Promise<string[]> {
  const d = await safeGet<{ indexes: string[] }>("/splunk/indexes", { indexes: [] });
  return d.indexes ?? [];
}

export async function getSourcetypes(index: string): Promise<string[]> {
  if (!index) return [];
  const d = await safeGet<{ sourcetypes: string[] }>(
    `/splunk/sourcetypes?index=${encodeURIComponent(index)}`,
    { sourcetypes: [] },
  );
  return d.sourcetypes ?? [];
}

export async function getFields(
  index: string,
  sourcetype: string,
): Promise<{ numeric_fields: string[]; suggested: string | null }> {
  if (!index || !sourcetype) return { numeric_fields: [], suggested: null };
  return safeGet(
    `/splunk/fields?index=${encodeURIComponent(index)}&sourcetype=${encodeURIComponent(sourcetype)}`,
    { numeric_fields: [], suggested: null },
  );
}
