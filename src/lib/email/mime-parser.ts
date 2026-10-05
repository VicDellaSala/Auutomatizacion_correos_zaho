import PostalMime from "postal-mime";
import type { Address, EmailData } from "@/types/email";
import { contentParts, htmlToText } from "./content-cleaner";
import { messageIds, normalizeSubject, sha256 } from "./normalize";
function addresses(list: unknown): Address[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((a) =>
    a.group
      ? addresses(a.group)
      : a.address
        ? [{ name: a.name || "", address: a.address.trim().toLowerCase() }]
        : [],
  );
}
export async function parseEmail(raw: Uint8Array | string): Promise<EmailData> {
  const mail = await PostalMime.parse(raw, {
    attachmentEncoding: "arraybuffer",
  });
  const from = addresses(mail.from ? [mail.from] : [])[0];
  if (!from || !mail.date || !Number.isFinite(Date.parse(mail.date)))
    throw new Error(
      "EML sin remitente o fecha válida; requiere corrección del archivo.",
    );
  const header = (key: string) =>
    mail.headers.find((h) => h.key.toLowerCase() === key)?.value;
  const messageId = messageIds(mail.messageId)[0] ?? null;
  const to = addresses(mail.to),
    cc = addresses(mail.cc),
    date = new Date(mail.date).toISOString();
  const subject = mail.subject ?? "(Sin asunto)";
  const bodyText = mail.text?.trim() || htmlToText(mail.html ?? "");
  const canonical = (a: Address[]) => a.map((x) => x.address).sort();
  const key = await sha256(
    messageId
      ? `id:${messageId}`
      : JSON.stringify([
          from.address,
          canonical(to),
          canonical(cc),
          date,
          subject,
          bodyText,
        ]),
  );
  return {
    key,
    messageId,
    inReplyTo: messageIds(mail.inReplyTo),
    references: messageIds(mail.references),
    date,
    from,
    to,
    cc,
    replyTo: addresses(mail.replyTo),
    subject,
    normalizedSubject: normalizeSubject(subject),
    bodyText,
    ...contentParts(bodyText),
    zohoStatus: header("x-zohomail-status") ?? null,
    attachments: mail.attachments.map((a) => ({
      filename: a.filename || "Sin nombre",
      mimeType: a.mimeType,
      size:
        typeof a.content === "string" ? a.content.length : a.content.byteLength,
    })),
  };
}
