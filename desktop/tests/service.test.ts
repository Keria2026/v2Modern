import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppService } from "../src/main/service";
import { CoreManager } from "../src/main/core-manager";
import { StateStore } from "../src/main/store";
import { defaults } from "../src/shared/model";
import { parseLink } from "../src/main/profiles";
test("subscription failures preserve previous nodes, successful replacement is atomic", async () => {
  const dir = await mkdtemp(join(tmpdir(), "v2-service-"));
  let response = "bad-data";
  const fetcher: typeof fetch = async () =>
    new Response(response, { status: 200 });
  const state = defaults();
  const subscription = {
    id: "sub",
    name: "Private subscription",
    url: "https://example.com/sub?token=private-token",
  };
  state.subscriptions = [subscription];
  state.nodes = [
    { ...parseLink("socks://127.0.0.1:12000#Existing"), subscriptionId: "sub" },
  ];
  state.selectedId = state.nodes[0].id;
  const manager = new CoreManager(dir, "/missing", {
    enable: async () => {},
    restore: async () => {},
  });
  const service = new AppService(
    state,
    new StateStore(dir, null),
    manager,
    "0.1",
    fetcher,
  );
  try {
    await assert.rejects(() =>
      service.action({ type: "update-subscription", id: "sub" }),
    );
    assert.equal(service.state.nodes[0].name, "Existing");
    assert.equal(service.state.subscriptions[0].updatedAt, undefined);
    response = "trojan://secret@remote.example:443#Updated";
    await service.action({ type: "update-subscription", id: "sub" });
    assert.equal(service.state.nodes.length, 1);
    assert.equal(service.state.nodes[0].name, "Updated");
    assert.ok(service.state.subscriptions[0].updatedAt);
    assert.equal(service.state.selectedId, service.state.nodes[0].id);
    assert.ok(
      !(await service.snapshot()).logs.some((log) =>
        log.message.includes("private-token"),
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("invalid actions and partially invalid imports leave state unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "v2-service-"));
  const manager = new CoreManager(dir, "/missing", {
    enable: async () => {},
    restore: async () => {},
  });
  const service = new AppService(
    defaults(),
    new StateStore(dir, null),
    manager,
    "0.1",
  );
  try {
    await assert.rejects(() =>
      service.action({
        type: "import",
        text: "socks://127.0.0.1:12000\ninvalid",
      }),
    );
    assert.equal(service.state.nodes.length, 0);
    await assert.rejects(() =>
      service.action({
        type: "settings",
        settings: { ...defaults().settings, httpPort: 10808 },
      }),
    );
    assert.equal(service.state.settings.httpPort, 10809);
    await service.action({
      type: "import",
      text: "socks://127.0.0.1:12000#Local",
    });
    assert.ok(service.state.selectedId);
    await service.action({
      type: "delete-node",
      id: service.state.selectedId!,
    });
    assert.equal(service.state.selectedId, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
