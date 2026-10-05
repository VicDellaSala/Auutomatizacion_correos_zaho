import { expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { escapeHtml } from "../src/lib/reports/html";
import { readJson, requireSameOrigin } from "../src/lib/http";
it("contraseñas con sal única, validación constante y rechazo de incorrectas", () => {
  const one = hashPassword("synthetic-password-123"),
    two = hashPassword("synthetic-password-123");
  expect(one).not.toBe(two);
  expect(verifyPassword("synthetic-password-123", one)).toBe(true);
  expect(verifyPassword("incorrecta", one)).toBe(false);
});
it("contenido HTML corporativo se escapa completamente en reportes", () => {
  expect(escapeHtml('<img src=x onerror="alert(1)"> & test')).toBe(
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; test",
  );
});
it("escritura rechaza origen externo o ausente", () => {
  expect(() =>
    requireSameOrigin(
      new Request("http://localhost:3000/api/settings", {
        method: "POST",
        headers: { origin: "https://foreign.test" },
      }),
    ),
  ).toThrow();
  expect(() =>
    requireSameOrigin(
      new Request("http://localhost:3000/api/settings", { method: "POST" }),
    ),
  ).toThrow();
});
it("API rechaza una petición demasiado grande durante su lectura", async () => {
  const request = new Request("http://localhost/api/imports", {
    method: "POST",
    body: "x".repeat(3200001),
  });
  await expect(readJson(request)).rejects.toThrow("demasiado grande");
});
