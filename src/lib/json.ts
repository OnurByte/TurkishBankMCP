export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function findArrayByKey(value: unknown, key: string): unknown[] {
  const root = asRecord(value);
  if (!root) return [];

  const direct = root[key];
  if (Array.isArray(direct)) return direct;

  for (const child of Object.values(root)) {
    const found = findArrayByKey(child, key);
    if (found.length > 0) return found;
  }

  return [];
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
