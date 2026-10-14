import test from "node:test";
import assert from "node:assert/strict";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import http from "node:http";
import net from "node:net";
import { chromium } from "playwright-core";
import { AppService } from "../src/main/service";
import { CoreManager } from "../src/main/core-manager";
import { StateStore } from "../src/main/store";
import { defaults } from "../src/shared/model";
const binary = process.env.V2MODERN_TEST_CORE;
async function listen(server: net.Server) {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as net.AddressInfo).port;
}
async function port() {
  const server = net.createServer(),
    p = await listen(server);
  await new Promise<void>((r) => server.close(() => r()));
  return p;
}
test("production UI imports and edits nodes, connects real fork, manages subscriptions and saves appearance", async () => {
  assert.ok(binary, "V2MODERN_TEST_CORE is required");
  const directory = await mkdtemp(join(tmpdir(), "v2-ui-")),
    root = resolve("dist/renderer");
  const web = http.createServer(async (req, res) => {
    try {
      const file = resolve(
        root,
        "." +
          decodeURIComponent(new URL(req.url!, "http://localhost").pathname),
      );
      if (!file.startsWith(root + sep) && file !== root) throw new Error();
      const target =
        file === root || file === root + sep ? join(root, "index.html") : file;
      const types: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
      };
      res.setHeader(
        "Content-Type",
        types[extname(target)] || "application/octet-stream",
      );
      res.end(await readFile(target));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  const fixture = http.createServer((_req, res) => res.end("ui-real-core-ok"));
  let upstream: ChildProcess | undefined;
  const settings = {
    ...defaults().settings,
    systemProxy: false,
    httpPort: await port(),
    socksPort: await port(),
  };
  const core = new CoreManager(join(directory, "runtime"), binary, {
    enable: async () => {
      throw new Error("UI tests must not change host system proxy");
    },
    restore: async () => {},
  });
  const state = defaults();
  state.settings = settings;
  const service = new AppService(
    state,
    new StateStore(directory, null),
    core,
    "0.1.0",
    async () =>
      new Response(
        "trojan://fixture-secret@subscription.example:443#Subscription fixture",
      ),
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.V2MODERN_TEST_CHROMIUM || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 920 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.exposeFunction("__desktopSnapshot", () => service.snapshot());
  await page.exposeFunction("__desktopAction", async (action: unknown) =>
    service.action(action),
  );
  await page.addInitScript({
    content: `window.desktop={snapshot:()=>window.__desktopSnapshot(),action:a=>window.__desktopAction(a),onSnapshot:callback=>{window.__push=callback;return()=>{window.__push=null;};},chooseXray:async()=>null,window:()=>{}};`,
  });
  const changed = () =>
    void service
      .snapshot()
      .then((snapshot) =>
        page.evaluate((value) => (window as any).__push?.(value), snapshot),
      )
      .catch(() => {});
  service.on("change", changed);
  try {
    const destination = await listen(fixture),
      upstreamPort = await port();
    const configPath = join(directory, "upstream.json");
    await writeFile(
      configPath,
      JSON.stringify({
        log: { loglevel: "error" },
        inbounds: [
          {
            listen: "127.0.0.1",
            port: upstreamPort,
            protocol: "socks",
            settings: { auth: "noauth" },
          },
        ],
        outbounds: [{ protocol: "freedom", settings: {} }],
      }),
    );
    upstream = spawn(binary, ["-config", configPath], { stdio: "ignore" });
    await page.goto(`http://127.0.0.1:${await listen(web)}/index.html`);
    await page.getByRole("heading", { name: "一切连接，尽在掌握。" }).waitFor();
    await page
      .getByRole("button", { name: "导入节点", exact: true })
      .first()
      .click();
    await page
      .getByRole("textbox", { name: "节点链接" })
      .fill(`socks://127.0.0.1:${upstreamPort}#Local connection`);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "导入节点" })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "连接节点", exact: true }).click();
    await page.getByText("连接已建立", { exact: true }).waitFor();
    assert.equal(core.connection.status, "connected");
    const response = await new Promise<string>((r, j) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port: settings.httpPort,
          agent: false,
          path: `http://127.0.0.1:${destination}/`,
          headers: { "Proxy-Connection": "keep-alive" },
        },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => r(text));
        },
      );
      req.on("error", j);
    });
    assert.equal(response, "ui-real-core-ok");
    await mkdir("docs", { recursive: true });
    await page.screenshot({
      path: "docs/screenshot-light.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "断开连接", exact: true }).click();
    await page.getByText("尚未连接", { exact: true }).waitFor();
    await page.getByRole("button", { name: "节点 1", exact: true }).click();
    await page
      .getByRole("button", { name: "编辑 Local connection", exact: true })
      .click();
    await page
      .getByLabel("节点名称", { exact: true })
      .fill("Edited local connection");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(service.state.nodes[0].name, "Edited local connection");
    await page.getByRole("button", { name: "订阅", exact: true }).click();
    await page
      .getByRole("button", { name: "添加订阅", exact: true })
      .first()
      .click();
    await page.getByLabel("订阅名称").fill("Test subscription");
    await page
      .getByLabel("HTTPS 订阅地址")
      .fill("https://subscription.example/sub?token=private-token");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "更新", exact: true }).click();
    await page
      .getByText("subscription.example · 1 个节点", { exact: true })
      .waitFor();
    assert.equal(service.state.nodes.length, 2);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "深色", exact: true }).click();
    await page.getByRole("switch", { name: "减少动态效果" }).click();
    await page.getByRole("button", { name: "保存设置" }).click();
    await page.locator(".app.dark.reduce-motion").waitFor();
    assert.equal(service.state.settings.theme, "dark");
    await page.getByRole("button", { name: "概览", exact: true }).click();
    await page.getByRole("button", { name: "关闭提示" }).click();
    await page.screenshot({ path: "docs/screenshot-dark.png", fullPage: true });
    await page.getByRole("button", { name: "连接日志", exact: true }).click();
    await page.getByRole("log").waitFor();
    assert.ok(
      !(await page
        .getByRole("log")
        .innerText()
        .then((v) => v.includes("private-token"))),
    );
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error("Renderer errors:", errors);
    console.error("UI text:", await page.locator("body").innerText());
    await page.screenshot({ path: "/tmp/v2-ui-failure.png" });
    throw error;
  } finally {
    service.off("change", changed);
    await core.disconnect();
    await browser.close();
    if (upstream && upstream.exitCode === null)
      await new Promise<void>((r) => {
        upstream!.once("exit", () => r());
        upstream!.kill();
      });
    for (const s of [web, fixture])
      await new Promise<void>((r) => s.close(() => r()));
    await rm(directory, { recursive: true, force: true });
  }
});
