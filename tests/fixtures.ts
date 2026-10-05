import { parseEmail } from "../src/lib/email/mime-parser";
import type { MatchMail } from "../src/types/email";
export const mailbox = "inbox@example.test",
  staff = "staff@example.test";
export function eml({
  id = "request@test",
  from = "Customer <customer@example.test>",
  date = "Sat, 03 Oct 2026 09:00:00 -0400",
  subject = "Cambio de canal",
  headers = "",
  body = "Buenos días, solicito un cambio.",
} = {}) {
  return `From: ${from}\r\nTo: ${mailbox}\r\nDate: ${date}\r\nSubject: ${subject}\r\nMessage-ID: <${id}>\r\nMIME-Version: 1.0\r\n${headers}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
}
export async function requestMail(id = "request@test") {
  return parseEmail(eml({ id }));
}
export async function responseMail(
  id = "response@test",
  parent = "request@test",
  date = "Sun, 04 Oct 2026 09:00:00 -0400",
) {
  return parseEmail(
    eml({
      id,
      from: `Agent <${staff}>`,
      date,
      subject: "RE: Cambio de canal",
      headers: `Cc: customer@example.test\r\nIn-Reply-To: <${parent}>\r\nReferences: <${parent}>\r\n`,
      body: "Cambio realizado.\n\nEl 3 de octubre escribió:\nTexto citado",
    }),
  );
}
export function matchMail(
  data: Awaited<ReturnType<typeof parseEmail>>,
): MatchMail {
  return {
    ...data,
    staffName: data.from.address === staff ? "Agente" : null,
    addressed: true,
    decision: null,
  };
}
