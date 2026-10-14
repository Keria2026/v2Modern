import test from "node:test";
import assert from "node:assert/strict";
import { parseLink, parseProfiles } from "../src/main/profiles";
import { generateConfig } from "../src/main/config";
import { defaults, nodeSchema } from "../src/shared/model";
import { redact } from "../src/main/core-manager";
const id = "e968cd1d-173e-4a86-9cfc-b57bb7deea54";
test("VMess import preserves TLS, WS host, path and alterId", () => {
  const data = {
    ps: "Test",
    add: "test.example",
    port: "443",
    id,
    aid: "4",
    net: "ws",
    tls: "tls",
    host: "ws.example",
    path: "/socket",
  };
  const n = parseLink(
    "vmess://" + Buffer.from(JSON.stringify(data)).toString("base64"),
  );
  const config = generateConfig(n, defaults().settings);
  assert.equal(n.alterId, 4);
  assert.equal(n.security, "tls");
  assert.deepEqual(config.outbounds[0].streamSettings.wsSettings, {
    path: "/socket",
    headers: { Host: "ws.example" },
  });
  assert.deepEqual(config.outbounds[0].streamSettings.tlsSettings, {
    serverName: "ws.example",
    allowInsecure: false,
  });
});
test("Reality links are accepted but fork refuses them, Xray configuration includes credentials", () => {
  const n = parseLink(
    `vless://${id}@test.example:443?security=reality&type=tcp&pbk=public-test&sid=abcd&sni=www.example.com&flow=xtls-rprx-vision#Reality`,
  );
  assert.throws(() => generateConfig(n, defaults().settings), /Xray/);
  const config = generateConfig(n, { ...defaults().settings, kernel: "xray" });
  assert.equal(config.outbounds[0].streamSettings.security, "reality");
  assert.equal(n.flow, "xtls-rprx-vision");
});
test("gRPC requires Xray and preserves service name", () => {
  const n = parseLink(
    `vless://${id}@test.example:443?security=tls&type=grpc&serviceName=service`,
  );
  assert.throws(() => generateConfig(n, defaults().settings), /Xray/);
  assert.deepEqual(
    generateConfig(n, { ...defaults().settings, kernel: "xray" }).outbounds[0]
      .streamSettings.grpcSettings,
    { serviceName: "service" },
  );
});
test("Shadowsocks SIP002 URL-safe base64 handles passwords containing colon", () => {
  const auth = Buffer.from("aes-128-gcm:secret:extra").toString("base64url");
  const n = parseLink(`ss://${auth}@server.example:8388#SS`);
  assert.equal(n.password, "secret:extra");
  assert.equal(n.cipher, "aes-128-gcm");
  const legacy = parseLink(
    "ss://" +
      Buffer.from("aes-256-gcm:password@server.example:8388").toString(
        "base64",
      ) +
      "#Old",
  );
  assert.equal(legacy.port, 8388);
});
test("Trojan URI decoding and TLS default", () => {
  const n = parseLink(
    "trojan://secret%3Aword@server.example:443?sni=tls.example#Trojan",
  );
  assert.equal(n.password, "secret:word");
  assert.equal(n.security, "tls");
});
test("base64 subscriptions and atomic parsing reject unsupported lines", () => {
  const list = `trojan://secret@one.example:443#One\nvless://${id}@two.example:443?security=tls#Two`;
  assert.equal(parseProfiles(Buffer.from(list).toString("base64")).length, 2);
  assert.throws(
    () => parseProfiles(list + "\nhysteria2://secret@three.example:443"),
    /第 3/,
  );
  assert.throws(
    () => parseLink(`vless://${id}@test.example:443?allowInsecure=1`),
    /不支持/,
  );
  assert.throws(
    () =>
      parseLink(
        `ss://${Buffer.from("aes-128-gcm:p").toString("base64")}@test.example:443?plugin=obfs-local`,
      ),
    /插件/,
  );
});
test("invalid UUID, ports and same listener port are rejected", () => {
  assert.throws(() => parseLink("vless://bad@test.example:443"));
  assert.throws(() =>
    nodeSchema.parse({
      id: "a",
      name: "a",
      protocol: "socks",
      address: "a",
      port: 65536,
    }),
  );
  const n = parseLink("socks://127.0.0.1:10000");
  assert.throws(
    () => generateConfig(n, { ...defaults().settings, socksPort: 10809 }),
    /端口/,
  );
});
test("logs redact credentials and complete profile URLs", () => {
  const n = parseLink("trojan://private-secret@test.example:443");
  assert.ok(
    !redact("private-secret trojan://private-secret@test.example", n).includes(
      "private-secret",
    ),
  );
});

test("credentials split across process output chunks are masked as a complete line", async () => {
  const { PassThrough } = await import("node:stream");
  const { captureLines } = await import("../src/main/core-manager");
  const stream = new PassThrough(),
    node = parseLink("trojan://private-secret@test.example:443"),
    output: string[] = [];
  const reader = captureLines(stream, (line) =>
    output.push(redact(line, node)),
  );
  const done = new Promise<void>((resolve) => reader.once("close", resolve));
  stream.write("private-");
  stream.write("secret\n");
  stream.end();
  await done;
  assert.deepEqual(output, ["[已隐藏]"]);
});
