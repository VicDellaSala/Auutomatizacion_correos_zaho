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
  await expect(page.getByRole("alert").filter({ hasText: "Clave incorrecta" })).toBeVisible();
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
  async function importFile(path: string) {
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
    const path = "test-results/large-synthetic.zip",
      output = createWriteStream(path);
    const writer = new ZipWriter(
      Writable.toWeb(output) as WritableStream<Uint8Array>,
    );
    // About 501 MiB on disk, written one entry at a time. No real corporate data.
    for (let n = 0; n < 501; n++) {
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
    console.log(`ZIP sintético listo: ${statSync(path).size} bytes`);
    await importFile(path);
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
    "E2E OK: autenticación, worker ZIP, staging, aprobación, cambio histórico, persistencia, HTML, respaldo, CSRF y móvil.",
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
