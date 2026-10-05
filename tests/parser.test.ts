import { describe, it, expect } from "vitest";
import { parseEmail } from "../src/lib/email/mime-parser";
import { normalizeSubject } from "../src/lib/email/normalize";
import { htmlToText } from "../src/lib/email/content-cleaner";
import { eml, responseMail } from "./fixtures";
describe("MIME real y normalización", () => {
  it("lee correo simple, cabeceras y acentos", async () => {
    const p = await parseEmail(eml());
    expect(p.bodyText).toContain("Buenos días");
    expect(p.messageId).toBe("request@test");
    expect(p.date).toBe("2026-10-03T13:00:00.000Z");
  });
  it("extrae In-Reply-To, References y conserva cuerpo citado", async () => {
    const p = await responseMail();
    expect(p.inReplyTo).toEqual(["request@test"]);
    expect(p.references).toEqual(["request@test"]);
    expect(p.newContent).toBe("Cambio realizado.");
    expect(p.bodyText).toContain("Texto citado");
  });
  it("decodifica quoted-printable e ISO-8859-1", async () => {
    const raw = eml({ body: "Informaci=F3n para Rub=E9n" }).replace(
      "charset=utf-8",
      "charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable",
    );
    expect((await parseEmail(raw)).bodyText).toBe("Información para Rubén");
  });
  it("decodifica base64 UTF-8", async () => {
    const raw = eml({
      body: Buffer.from("Validación y atención").toString("base64"),
    }).replace(
      "charset=utf-8",
      "charset=utf-8\r\nContent-Transfer-Encoding: base64",
    );
    expect((await parseEmail(raw)).bodyText).toBe("Validación y atención");
  });
  it("HTML solo: texto legible, scripts eliminados", async () => {
    const p = await parseEmail(
      eml({
        body: "<div>Hola &amp; gracias</div><script>alert(1)</script><p>Atención</p>",
      }).replace("text/plain", "text/html"),
    );
    expect(p.bodyText).toContain("Hola & gracias");
    expect(p.bodyText).not.toContain("alert");
    expect(htmlToText("<style>bad</style><p>Texto</p>")).toBe("Texto");
  });
  it("multipart/alternative y mixed conservan texto y metadata sin adjuntos binarios", async () => {
    const raw =
      eml().split("Content-Type:")[0] +
      `Content-Type: multipart/mixed; boundary="mix"\r\n\r\n--mix\r\nContent-Type: multipart/alternative; boundary="alt"\r\n\r\n--alt\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nVersión texto\r\n--alt\r\nContent-Type: text/html\r\n\r\n<p>Versión HTML</p>\r\n--alt--\r\n--mix\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="formulario.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\naG9sYQ==\r\n--mix--`;
    const p = await parseEmail(raw);
    expect(p.bodyText).toBe("Versión texto");
    expect(p.attachments).toEqual([
      { filename: "formulario.pdf", mimeType: "application/pdf", size: 4 },
    ]);
    expect(JSON.stringify(p)).not.toContain("aG9sYQ==");
  });
  it("normaliza prefijos repetidos y conserva asunto original", async () => {
    expect(normalizeSubject("RE: RV: Fwd: Respuesta:  Cambio   de Canal")).toBe(
      "cambio de canal",
    );
    const p = await parseEmail(eml({ subject: "Re: Cambio" }));
    expect(p.subject).toBe("Re: Cambio");
  });
  it("deduplica sin Message-ID de manera estable", async () => {
    const raw = eml().replace(/Message-ID:.*\r\n/, "");
    expect((await parseEmail(raw)).key).toBe((await parseEmail(raw)).key);
  });
  it("rechaza EML sin fecha o remitente", async () => {
    await expect(
      parseEmail("Content-Type: text/plain\r\n\r\nroto"),
    ).rejects.toThrow();
  });
  it("lee remitente y asunto codificados, Reply-To y estado Zoho", async () => {
    const raw = eml({
      from: "=?UTF-8?B?UnViw6lu?= <staff@example.test>",
      subject: "=?UTF-8?Q?Atenci=C3=B3n?=",
      headers: "Reply-To: other@example.test\r\nX-ZohoMail-Status: 1\r\n",
    });
    const p = await parseEmail(raw);
    expect(p.from.name).toBe("Rubén");
    expect(p.subject).toBe("Atención");
    expect(p.replyTo[0].address).toBe("other@example.test");
    expect(p.zohoStatus).toBe("1");
  });
});
