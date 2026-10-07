import { expect, it } from "vitest";
import { matchEmails } from "../src/lib/matching/matcher";
import { parseEmail } from "../src/lib/email/mime-parser";
import { eml, requestMail, responseMail, matchMail, staff } from "./fixtures";
it("solicitud y respuesta al día siguiente se asocian por cabeceras", async () => {
  const a = await requestMail(),
    b = await responseMail();
  const m = matchEmails([matchMail(b), matchMail(a)]);
  expect(m.get(a.key)?.kind).toBe("REQUEST");
  expect(m.get(b.key)).toMatchObject({ kind: "RESPONSE", rootKey: a.key });
});
it("correo iniciado por personal no cuenta como respuesta", async () => {
  const a = await parseEmail(eml({ from: staff, id: "new@test" }));
  expect(matchEmails([matchMail(a)]).get(a.key)?.kind).toBe("STAFF_SENT");
});
it("cabecera ausente con asunto específico, participantes y tiempo claro se resuelve automáticamente", async () => {
  const a = await requestMail(),
    b = await responseMail("reply@test", "missing@test");
  const m = matchEmails([matchMail(a), matchMail(b)]);
  expect(m.get(b.key)).toMatchObject({ kind: "RESPONSE", rootKey: a.key });
});
it("respuesta anterior al original nunca es válida", async () => {
  const a = await requestMail(),
    b = await responseMail(
      "reply@test",
      "request@test",
      "Fri, 02 Oct 2026 09:00:00 -0400",
    );
  expect(matchEmails([matchMail(a), matchMail(b)]).get(b.key)?.kind).toBe(
    "REVIEW",
  );
});
it("múltiples respuestas y References reconstruyen el mismo hilo", async () => {
  const a = await requestMail(),
    b = await responseMail(),
    c = await responseMail(
      "third@test",
      "response@test",
      "Mon, 05 Oct 2026 09:00:00 -0400",
    );
  const m = matchEmails([matchMail(c), matchMail(b), matchMail(a)]);
  expect(m.get(c.key)).toMatchObject({ kind: "RESPONSE", rootKey: a.key });
});
it("followup externo conserva hilo sin contar como respuesta del equipo", async () => {
  const a = await requestMail(),
    b = await responseMail();
  b.from = { name: "Customer", address: "customer@example.test" };
  expect(matchEmails([matchMail(a), matchMail(b)]).get(b.key)?.kind).toBe(
    "FOLLOWUP",
  );
});
it("decisión manual debe respetar remitente y cronología", async () => {
  const a = matchMail(await requestMail());
  a.decision = { kind: "STAFF_SENT" };
  expect(matchEmails([a]).get(a.key)?.kind).toBe("REVIEW");
});
it("no permite asociación manual consigo misma ni con otra respuesta", async () => {
  const a = matchMail(await requestMail()),
    b = matchMail(await responseMail()),
    c = matchMail(
      await responseMail(
        "extra@test",
        "request@test",
        "Sun, 04 Oct 2026 09:01:00 -0400",
      ),
    );
  c.decision = { kind: "RESPONSE", targetKey: c.key };
  expect(matchEmails([a, b, c]).get(c.key)?.kind).toBe("REVIEW");
  c.decision.targetKey = b.key;
  expect(matchEmails([a, b, c]).get(c.key)?.kind).toBe("REVIEW");
});
it("construye la cadena sin cabeceras y cuenta cada respuesta", async () => {
  const a = matchMail(await requestMail());
  const b = matchMail(await responseMail());
  b.inReplyTo = [];
  b.references = [];
  const c = matchMail(
    await responseMail(
      "extra@test",
      "missing@test",
      "Sun, 04 Oct 2026 09:01:00 -0400",
    ),
  );
  const d = matchMail(
    await parseEmail(
      eml({
        id: "follow@test",
        subject: "Re: Cambio de canal",
        date: "Sun, 04 Oct 2026 09:02:00 -0400",
      }),
    ),
  );
  const e = matchMail(
    await responseMail(
      "third@test",
      "missing@test",
      "Sun, 04 Oct 2026 09:03:00 -0400",
    ),
  );
  const matches = matchEmails([e, d, c, b, a]);
  expect([...matches.values()].map((m) => m.kind)).toEqual([
    "REQUEST",
    "RESPONSE",
    "RESPONSE",
    "FOLLOWUP",
    "RESPONSE",
  ]);
  expect([...matches.values()].every((m) => m.rootKey === a.key)).toBe(true);
});
it("asunto genérico sin participantes compatibles o con dos originales permanece ambiguo", async () => {
  const a = matchMail(await requestMail()),
    b = matchMail(await responseMail()),
    c = matchMail(await requestMail("other@test"));
  for (const m of [a, b, c]) m.normalizedSubject = "solicitud";
  b.inReplyTo = [];
  b.references = [];
  expect(matchEmails([a, b, c]).get(b.key)?.kind).toBe("REVIEW");
  b.cc = [];
  expect(matchEmails([a, b]).get(b.key)?.kind).toBe("STAFF_SENT");
  b.inReplyTo = [];
  b.references = [];
  expect(matchEmails([a, b]).get(b.key)?.kind).toBe("STAFF_SENT");
});
