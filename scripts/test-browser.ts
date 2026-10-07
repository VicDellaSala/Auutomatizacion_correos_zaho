import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { chromium, expect } from "@playwright/test";
import { readFileSync, mkdirSync, createWriteStream, statSync } from "node:fs";
import { Writable } from "node:stream";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { ZipWriter, TextReader, configure } from "@zip.js/zip.js";
import { eml, staff, mailbox } from "../tests/fixtures";
configure({ useWebWorkers: false });
const pg = await PGlite.create();
await pg.exec(readFileSync("drizzle/0000_smart_pestilence.sql", "utf8"));
const password = randomBytes(20).toString("hex");
await pg.query("insert into settings (id,mailbox) values (1,$1)", [mailbox]);
await pg.query("insert into agents (name,email) values ('Agente',$1)", [staff]);
const server = new PGLiteSocketServer({
  db: pg,
  host: "127.0.0.1",
  port: 55439,
  maxConnections: 20,
});
await server.start();
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3107",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55439/postgres",
      AUTH_SECRET: randomBytes(32).toString("hex"),
      APP_PASSWORD: password,
      APP_URL: "http://127.0.0.1:3107",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));
mkdirSync("test-results", { recursive: true });
const browser = await chromium.launch({
  channel: process.env.E2E_BROWSER ?? "chrome",
  headless: true,
});
try {
  for (let n = 0; n < 60; n++) {
    try {
      if ((await fetch("http://127.0.0.1:3107/login")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(30000);
  const browserErrors: string[] = [];
  page.on("pageerror", (e) => browserErrors.push(e.message));
  const anonymous = await page.request.get("http://127.0.0.1:3107/api/backup");
  expect(anonymous.status()).toBe(401);
  await page.goto("http://127.0.0.1:3107/dashboard");
  await expect(page).toHaveURL(/login/);
  await expect(page.getByLabel("Correo de acceso")).toHaveCount(0);
  expect((await pg.query("select * from users")).rows).toHaveLength(0);
  await page
    .getByLabel("Clave de acceso", { exact: true })
    .fill("incorrect-test-only");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Clave incorrecta" }),
  ).toBeVisible();
  expect((await pg.query("select * from sessions")).rows).toHaveLength(0);
  await page.getByLabel("Clave de acceso", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(
    page.getByRole("heading", { name: "Resumen general" }),
  ).toBeVisible();
  expect((await pg.query("select * from users")).rows).toHaveLength(1);
  async function zip(path: string, mails: string[], large = false) {
    const output = createWriteStream(path);
    const writer = new ZipWriter(
      Writable.toWeb(output) as WritableStream<Uint8Array>,
    );
    for (let n = 0; n < mails.length; n++)
      await writer.add(`${n}.eml`, new TextReader(mails[n]), {
        level: large ? 0 : 6,
      });
    await writer.close();
  }
  await zip("test-results/request.zip", [eml()]);
  await zip("test-results/response.zip", [
    eml({
      id: "response@test",
      from: staff,
      date: "Sun, 04 Oct 2026 09:00:00 -0400",
      subject: "RE: Cambio de canal",
      headers: "In-Reply-To: <request@test>\r\n",
    }),
  ]);
  async function importFile(path: string | string[]) {
    await page.goto("http://127.0.0.1:3107/import");
    await page.locator('input[type="file"]').setInputFiles(path);
    await page
      .getByRole("button", { name: "Procesar ZIP", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Revisar importación →", exact: true }),
    ).toBeVisible({ timeout: 300000 });
    await page
      .getByRole("link", { name: "Revisar importación →", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Revisar importación", exact: true }),
    ).toBeVisible();
  }
  async function approveAll() {
    await page
      .getByRole("button", {
        name: "Aprobar todos los pendientes",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Confirmar aprobación", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Aprobar todos los pendientes",
        exact: true,
      }),
    ).toHaveCount(0);
  }
  await importFile("test-results/request.zip");
  expect((await pg.query("select * from emails")).rows).toHaveLength(0);
  await approveAll();
  await page.goto("http://127.0.0.1:3107/unanswered");
  await page
    .getByRole("link", { name: "Abrir correo completo →" })
    .first()
    .click();
  await expect(page.getByText("No respondida", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Buenos días, solicito un cambio.", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Origen:", { exact: false })).toContainText(
    "request.zip",
  );
  expect(
    (
      await pg.query(
        'select * from conversations where "firstResponseKey" is not null',
      )
    ).rows,
  ).toHaveLength(0);
  await importFile("test-results/response.zip");
  expect(
    (
      await pg.query(
        'select * from conversations where "firstResponseKey" is not null',
      )
    ).rows,
  ).toHaveLength(0);
  await page.locator(".review-row summary").first().click();
  await expect(
    page.getByText("Estado actual: No respondida", { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/review.png", fullPage: true });
  await approveAll();
  expect(
    (
      await pg.query(
        'select * from conversations where "firstResponseKey" is not null',
      )
    ).rows,
  ).toHaveLength(1);
  await page.goto("http://127.0.0.1:3107/dashboard");
  await expect(
    page.getByRole("heading", { name: "Resumen general" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page.reload();
  await expect(page.locator(".metric").nth(1)).toContainText("1");
  const report = await page.evaluate(async () => {
    const r = await fetch("/api/reports");
    return { ok: r.ok, text: await r.text() };
  });
  expect(report.ok).toBe(true);
  expect(report.text).toContain("Cambio de canal");
  const backup = await page.evaluate(async () => {
    const r = await fetch("/api/backup");
    return { ok: r.ok, text: await r.text() };
  });
  expect(backup.ok).toBe(true);
  expect(backup.text).toContain('"end":true');
  const csrf = await page.request.post("http://127.0.0.1:3107/api/settings", {
    headers: { Origin: "https://invalid.example.test" },
    data: {},
  });
  expect(csrf.status()).toBe(400);
  // Both ZIPs contain the same internal filename; provenance must remain distinct.
  await zip("test-results/part-one.zip", [
    eml({ id: "multi@test", subject: "Afiliación comercio 501" }),
  ]);
  await zip("test-results/part-two.zip", [
    eml({
      id: "multi-reply@test",
      from: staff,
      date: "Sun, 04 Oct 2026 09:00:00 -0400",
      subject: "Re: Afiliación comercio 501",
      headers: "Cc: customer@example.test\r\n",
    }),
  ]);
  await importFile(["test-results/part-one.zip", "test-results/part-two.zip"]);
  await page.locator('a[href="?group=RESPONSE"]').click();
  await expect(page.locator('.review-row > input[type="checkbox"]')).toHaveCount(
    1,
  );
  await page.locator(".review-row summary").first().click();
  await expect(
    page.getByText("Asociada automáticamente:", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Al aprobar este correo", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Resolver asociación pendiente", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Seleccionar esta página", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Aprobar e incorporar seleccionados",
      exact: true,
    })
    .click();
  await expect(page.locator(".review-row")).toHaveCount(0);
  expect(
    (await pg.query("select * from emails where data->>'subject' like '%501%'"))
      .rows,
  ).toHaveLength(2);
  await zip(
    "test-results/pages.zip",
    Array.from({ length: 82 }, (_, i) =>
      eml({ id: `pages-${i}@test`, subject: `Solicitud de prueba ${i}` }),
    ),
  );
  await importFile("test-results/pages.zip");
  const reviewUrl = page.url();
  await expect(
    page.locator('.review-row > input[type="checkbox"]:enabled'),
  ).toHaveCount(30);
  await page
    .getByRole("button", { name: "Seleccionar esta página", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Aprobar e incorporar seleccionados",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("0 seleccionados", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.review-row > input[type="checkbox"]:checked'),
  ).toHaveCount(0);
  await expect(
    page.locator('.review-row > input[type="checkbox"]:enabled'),
  ).toHaveCount(30);
  await page.getByRole("link", { name: "Siguiente", exact: true }).click();
  await expect(
    page.locator('.review-row > input[type="checkbox"]:enabled'),
  ).toHaveCount(22);
  await page
    .getByRole("button", { name: "Seleccionar esta página", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Aprobar e incorporar seleccionados",
      exact: true,
    })
    .click();
  await expect(
    page.locator('.review-row > input[type="checkbox"]:enabled'),
  ).toHaveCount(30);
  await page
    .getByRole("button", { name: "Seleccionar esta página", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Rechazar seleccionados", exact: true })
    .click();
  await expect(page.locator(".review-row")).toHaveCount(0);
  expect(
    (
      await pg.query(
        "select * from staged_emails where \"importId\"=$1 and state='APPROVED'",
        [reviewUrl.split("/").at(-1)],
      )
    ).rows,
  ).toHaveLength(52);
  await zip("test-results/late-request.zip", [
    eml({
      id: "late-ui@test",
      subject: "Prueba UI pendiente 16:55",
      date: "Mon, 05 Oct 2026 16:55:00 -0400",
    }),
  ]);
  await importFile("test-results/late-request.zip");
  await approveAll();
  await page.goto("http://127.0.0.1:3107/after-hours");
  await expect(
    page.getByRole("link", { name: "Prueba UI pendiente 16:55", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Editar", exact: true }).first().click();
  await page.getByLabel("Ignorar (conservar fuera de métricas)").check();
  await page
    .getByLabel("Motivo de ignorado")
    .fill("Reporte sintético para pruebas");
  await page
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Cambio guardado");
  await page.goto("http://127.0.0.1:3107/ignored");
  await expect(
    page.getByRole("link", { name: "Prueba UI pendiente 16:55", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Editar", exact: true }).first().click();
  await page.getByLabel("Ignorar (conservar fuera de métricas)").uncheck();
  await page
    .getByLabel("Estado de la solicitud", { exact: true })
    .selectOption("ANSWERED");
  await page
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Cambio guardado");
  await page
    .getByText("Auditoría de correcciones (2)", { exact: true })
    .click();
  await page.screenshot({
    path: "test-results/historical-edit.png",
    fullPage: true,
  });
  await page.goto("http://127.0.0.1:3107/answered");
  await expect(
    page.getByText("Estado ajustado manualmente", { exact: true }),
  ).toBeVisible();
  await page.goto("http://127.0.0.1:3107/after-hours");
  await expect(
    page.getByRole("link", { name: "Prueba UI pendiente 16:55", exact: true }),
  ).toHaveCount(0);
  await zip("test-results/manual-response.zip", [
    eml({
      id: "manual-ui@test",
      from: staff,
      subject: "Re: Asunto sintético ausente",
      date: "Tue, 06 Oct 2026 09:00:00 -0400",
      headers: "In-Reply-To: <manual-original@test>\r\n",
    }),
  ]);
  await importFile("test-results/manual-response.zip");
  await page.locator(".review-row summary").first().click();
  await page
    .getByText("Corregir clasificación (opcional) / resolver asociación", {
      exact: true,
    })
    .click();
  await page
    .getByLabel("Clasificación", { exact: true })
    .selectOption("RESPONSE");
  await page
    .getByRole("button", { name: "Guardar decisión", exact: true })
    .click();
  await expect(page.getByText("Respuesta", { exact: true })).toBeVisible();
  await approveAll();
  await page.goto("http://127.0.0.1:3107/responses");
  await expect(page.getByText("Sin asociación", { exact: true })).toBeVisible();
  const unlinked = await pg.query(
    'select "rootKey",kind from emails where "messageId"=$1',
    ["manual-ui@test"],
  );
  expect(unlinked.rows[0]).toMatchObject({ rootKey: null, kind: "RESPONSE" });
  // Preview is non-destructive; explicit confirmation executes only against this isolated test DB.
  await page.goto("http://127.0.0.1:3107/settings");
  await expect(
    page.getByRole("heading", { name: "Limpiar datos importados" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Previsualizar limpieza", exact: true })
    .click();
  await expect(
    page.getByLabel("Escribe ELIMINAR para confirmar"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Eliminar importaciones indicadas",
      exact: true,
    }),
  ).toBeDisabled();
  expect((await pg.query("select * from emails")).rows.length).toBeGreaterThan(
    0,
  );
  await page.screenshot({
    path: "test-results/cleanup-preview.png",
    fullPage: true,
  });
  await page.getByLabel("Escribe ELIMINAR para confirmar").fill("ELIMINAR");
  await page
    .getByRole("button", {
      name: "Eliminar importaciones indicadas",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Limpieza completada.", { exact: false }),
  ).toBeVisible();
  expect((await pg.query("select * from emails")).rows).toHaveLength(0);
  expect((await pg.query("select * from users")).rows).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:3107/dashboard");
  await expect(
    page.getByRole("heading", { name: "Resumen general" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (process.argv.includes("--large")) {
    const paths = [
        "test-results/large-part-1.zip",
        "test-results/large-part-2.zip",
      ],
      output = createWriteStream(paths[0]);
    let writer = new ZipWriter(
      Writable.toWeb(output) as WritableStream<Uint8Array>,
    );
    // About 501 MiB on disk, written one entry at a time. No real corporate data.
    for (let n = 0; n < 501; n++) {
      if (n === 250) {
        await writer.close();
        writer = new ZipWriter(
          Writable.toWeb(
            createWriteStream(paths[1]),
          ) as WritableStream<Uint8Array>,
        );
      }
      const raw =
        eml({ id: `large-${n}@test` }).split("Content-Type:")[0] +
        `Content-Type: multipart/mixed; boundary="x"\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nSolicitud sintética ${n}\r\n--x\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="synthetic.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n${"AAAA".repeat(262144)}\r\n--x--`;
      await writer.add(`${n}.eml`, new TextReader(raw), { level: 0 });
    }
    await writer.close();
    let maxBatch = 0;
    page.on("request", (r) => {
      if (r.url().includes("staging-batch"))
        maxBatch = Math.max(maxBatch, r.postDataBuffer()?.byteLength ?? 0);
    });
    console.log(
      `ZIP sintéticos listos: ${paths.reduce((n, p) => n + statSync(p).size, 0)} bytes en dos partes`,
    );
    await importFile(paths);
    expect(maxBatch).toBeLessThan(3200000);
    const count = await pg.query<{ count: number }>(
      "select count(*)::int as count from staged_emails where state='PENDING'",
    );
    expect(count.rows[0].count).toBe(501);
    console.log(
      `501 EML procesados en staging; mayor petición: ${maxBatch} bytes`,
    );
  }
  expect(browserErrors).toEqual([]);
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/login/);
  console.log(
    "E2E OK: autenticación, varios ZIP, dependencias, 82 solicitudes con aprobación parcial y rechazo, pendientes fuera de horario, ignorar/restaurar, edición con auditoría, respuesta sin asociación, limpieza confirmada, staging, histórico, HTML, respaldo, CSRF y móvil.",
  );
} catch (error) {
  console.error(appLog.slice(-2500));
  throw error;
} finally {
  await browser.close();
  app.kill();
  await server.stop();
  await pg.close();
}
