import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  recoveryState,
  RegistryState,
  WindowsSystemProxy,
} from "../src/main/system-proxy";
const previous: RegistryState = {
  ProxyEnable: { exists: true, value: 0 },
  ProxyServer: { exists: false, value: null },
  ProxyOverride: { exists: false, value: null },
};
const expected: RegistryState = {
  ProxyEnable: { exists: true, value: 1 },
  ProxyServer: {
    exists: true,
    value: "http=127.0.0.1:10809;https=127.0.0.1:10809",
  },
  ProxyOverride: { exists: true, value: "<local>" },
};
test("proxy recovery restores owned settings while preserving external bypass changes", () => {
  assert.deepEqual(recoveryState(previous, expected, expected), previous);
  const changed = {
    ...expected,
    ProxyOverride: { exists: true, value: "localhost;other.example" },
  };
  assert.deepEqual(recoveryState(previous, expected, changed), {
    ...previous,
    ProxyOverride: changed.ProxyOverride,
  });
  assert.equal(
    recoveryState(previous, expected, {
      ...expected,
      ProxyServer: { exists: true, value: "third-party:8080" },
    }),
    null,
  );
  assert.equal(
    recoveryState(previous, expected, {
      ...expected,
      ProxyEnable: { exists: true, value: 0 },
    }),
    null,
  );
});
test(
  "Windows native registry proxy activation and startup recovery",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "v2-win-proxy-")),
      journal = join(directory, "recovery.json");
    const proxy = new WindowsSystemProxy(journal);
    const read = async () => {
      const script =
        "$k=Get-Item -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; $r=@{}; foreach($n in @('ProxyEnable','ProxyServer','ProxyOverride')) { $e=$k.GetValueNames() -contains $n; $r[$n]=@{exists=$e;value=$k.GetValue($n,$null)} }; $r | ConvertTo-Json -Compress";
      const { stdout } = await promisify(execFile)(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        { windowsHide: true },
      );
      return JSON.parse(stdout) as RegistryState;
    };
    const initial = await read();
    try {
      await proxy.enable(10890);
      const actual = await read();
      assert.equal(actual.ProxyEnable.value, 1);
      assert.equal(
        actual.ProxyServer.value,
        "http=127.0.0.1:10890;https=127.0.0.1:10890",
      );
      assert.ok(await readFile(journal));
      await new WindowsSystemProxy(journal).restore();
      assert.deepEqual(await read(), initial);
      await assert.rejects(() => readFile(journal));
    } finally {
      await proxy.restore();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
