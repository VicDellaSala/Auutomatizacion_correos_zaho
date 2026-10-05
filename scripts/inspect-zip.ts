import { openAsBlob } from "node:fs";
import {
  BlobReader,
  ZipReader,
  Uint8ArrayWriter,
  configure,
} from "@zip.js/zip.js";
import { parseEmail } from "../src/lib/email/mime-parser";
import { matchEmails } from "../src/lib/matching/matcher";
import type { MatchMail } from "../src/types/email";
import { emailSchema } from "../src/lib/validation/email";
configure({ useWebWorkers: false });
const path = process.argv[2];
if (!path) throw new Error("Uso: npm run inspect:zip -- ruta/al/archivo.zip");
const reader = new ZipReader(new BlobReader(await openAsBlob(path)));
const staff = [
  "geraldine.serrano",
  "ruben.castro",
  "lyliana.tarazona",
  "yessika.salcedo",
];
const counts = {
  entries: 0,
  parsed: 0,
  errors: 0,
  withBody: 0,
  withMessageId: 0,
  withReply: 0,
  attachmentMetadata: 0,
  maxEmlBytes: 0,
  staffSenders: Object.fromEntries(staff.map((s) => [s, 0])),
  classifications: {} as Record<string, number>,
};
const mails: MatchMail[] = [];
for await (const entry of reader.getEntriesGenerator()) {
  if (entry.directory || !/\.eml$/i.test(entry.filename)) continue;
  counts.entries++;
  counts.maxEmlBytes = Math.max(counts.maxEmlBytes, entry.uncompressedSize);
  try {
    if (entry.uncompressedSize > 64 * 1024 * 1024)
      throw new Error("Límite EML");
    const data = await parseEmail(
      await entry.getData(new Uint8ArrayWriter(), { checkSignature: true }),
    );
    emailSchema.parse(data);
    counts.parsed++;
    if (data.bodyText) counts.withBody++;
    if (data.messageId) counts.withMessageId++;
    if (data.inReplyTo.length) counts.withReply++;
    counts.attachmentMetadata += data.attachments.length;
    const member =
      staff.find((s) => `${s}@credicard.com.ve` === data.from.address) ?? null;
    if (member) counts.staffSenders[member]++;
    const {
      key,
      messageId,
      inReplyTo,
      references,
      date,
      from,
      to,
      cc,
      subject,
      normalizedSubject,
    } = data;
    mails.push({
      key,
      messageId,
      inReplyTo,
      references,
      date,
      from,
      to,
      cc,
      subject,
      normalizedSubject,
      staffName: member,
      addressed: [...to, ...cc].some(
        (a) => a.address === "atencionagentes@credicard.com.ve",
      ),
      decision: null,
    });
  } catch {
    counts.errors++;
  }
}
await reader.close();
for (const m of matchEmails(mails).values())
  counts.classifications[m.kind] = (counts.classifications[m.kind] ?? 0) + 1;
console.log(JSON.stringify(counts, null, 2));
