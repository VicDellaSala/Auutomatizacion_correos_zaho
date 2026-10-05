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
it("asunto genérico o padre ausente requiere revisión", async () => {
  const a = await requestMail(),
    b = await responseMail("reply@test", "missing@test");
  const m = matchEmails([matchMail(a), matchMail(b)]);
  expect(m.get(b.key)?.kind).toBe("REVIEW");
  expect(m.get(b.key)?.candidates).toContain(a.key);
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
