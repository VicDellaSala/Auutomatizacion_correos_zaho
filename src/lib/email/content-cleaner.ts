import { parseDocument } from "htmlparser2";
import { textContent, removeElement, findAll } from "domutils";
export function htmlToText(html: string) {
  const document = parseDocument(
    html.replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, "\n"),
  );
  for (const node of findAll(
    (n) =>
      ["script", "style", "head", "iframe", "object", "svg"].includes(n.name),
    document.children,
  ))
    removeElement(node);
  return textContent(document)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function contentParts(bodyText: string) {
  // Keep the full text; this conservative split affects only the preview/new-content field.
  const boundary =
    /\n(?:On .{4,200}wrote:|El .{4,200}escribi[oó]:|_{8,}|-{5,}\s*(?:Original Message|Mensaje original)|>)/i;
  const cut = bodyText.search(boundary);
  const newContent = (cut > 0 ? bodyText.slice(0, cut) : bodyText).trim();
  return { newContent, preview: newContent.replace(/\s+/g, " ").slice(0, 260) };
}
