export function normalizeSubject(value: string) {
  return value
    .replace(
      /^(\s*(?:re|rv|fw|fwd|respuesta|reenviar)(?:\[\d+\])?\s*:\s*)+/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es");
}
export function messageIds(value?: string) {
  if (!value) return [];
  const ids = value.match(/<[^<>\s]+>/g);
  return [
    ...new Set(
      (ids ?? value.split(/\s+/))
        .map((s) => s.trim().replace(/^<|>$/g, ""))
        .filter(Boolean),
    ),
  ];
}
export async function sha256(value: string | Uint8Array) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
