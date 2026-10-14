import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { StateStore } from "../src/main/store";
import { defaults } from "../src/shared/model";
import { parseLink } from "../src/main/profiles";
test("encrypted state roundtrip never writes plaintext profile credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "v2-store-"));
  const key = randomBytes(32);
  const codec = {
    encrypt(value: string) {
      const iv = randomBytes(12),
        c = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), data]);
    },
    decrypt(value: Buffer) {
      const c = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      c.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([c.update(value.subarray(28)), c.final()]).toString(
        "utf8",
      );
    },
  };
  try {
    const store = new StateStore(dir, codec),
      state = defaults();
    state.nodes = [parseLink("trojan://private-secret@host.example:443")];
    await store.save(state);
    assert.deepEqual(await store.load(), state);
    const bytes = await readFile(join(dir, "profiles.enc"));
    assert.ok(!bytes.toString().includes("private-secret"));
    await assert.rejects(() => new StateStore(dir, null).load(), /无法解密/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("without secure storage, credentials remain session-only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "v2-store-"));
  try {
    const store = new StateStore(dir, null);
    await store.save(defaults());
    await assert.rejects(() => readFile(join(dir, "profiles.enc")));
    assert.equal(store.secure, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
