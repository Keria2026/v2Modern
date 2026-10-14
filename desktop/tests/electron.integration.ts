import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron } from "playwright-core";
test("actual Electron preload, IPC, node editing, persistence and window controls work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "v2-electron-"));
  const args = [resolve("tests/electron-entry.cjs")];
  if (process.platform === "linux")
    args.unshift("--no-sandbox", "--disable-gpu");
  let application = await _electron.launch({
    args,
    env: { ...process.env, V2MODERN_TEST_USER_DATA: directory },
    timeout: 20000,
  });
  try {
    let page = await application.firstWindow();
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("heading", { name: "一切连接，尽在掌握。" }).waitFor();
    const initial = await page.evaluate(() => window.desktop.snapshot());
    assert.equal(initial.nodes.length, 0);
    await page
      .getByRole("button", { name: "导入节点", exact: true })
      .first()
      .click();
    await page
      .getByRole("textbox", { name: "节点链接" })
      .fill("socks://127.0.0.1:12000#Electron smoke");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "导入节点" })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const snapshot = await page.evaluate(() => window.desktop.snapshot());
    assert.equal(snapshot.nodes[0].name, "Electron smoke");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "深色", exact: true }).click();
    await page.getByRole("button", { name: "保存设置" }).click();
    await page.locator(".app.dark").waitFor();
    assert.equal(
      (await page.evaluate(() => window.desktop.snapshot())).settings.theme,
      "dark",
    );
    if (process.platform === "win32") {
      assert.equal(
        snapshot.storageSecure,
        true,
        "Windows safeStorage should provide DPAPI encryption",
      );
      await application.close();
      application = await _electron.launch({
        args,
        env: { ...process.env, V2MODERN_TEST_USER_DATA: directory },
        timeout: 20000,
      });
      page = await application.firstWindow();
      await page
        .getByRole("heading", { name: "一切连接，尽在掌握。" })
        .waitFor();
      const restored = await page.evaluate(() => window.desktop.snapshot());
      assert.equal(restored.nodes[0].name, "Electron smoke");
      assert.equal(restored.settings.theme, "dark");
      page.on("pageerror", (error) => errors.push(error.message));
    }
    if (process.platform === "win32") {
      await page.getByRole("button", { name: "最小化", exact: true }).click();
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isMinimized(),
        ),
        true,
      );
    }
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].restore(),
    );
    assert.deepEqual(errors, []);
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
