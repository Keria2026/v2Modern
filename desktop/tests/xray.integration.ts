import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn, ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import net from "node:net";
import { CoreManager } from "../src/main/core-manager";
import { generateConfig } from "../src/main/config";
import { defaults, nodeSchema } from "../src/shared/model";
import { parseLink } from "../src/main/profiles";
const run = promisify(execFile),
  xray = process.env.V2MODERN_TEST_XRAY;
async function listen(server: net.Server) {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as net.AddressInfo).port;
}
async function port() {
  const server = net.createServer(),
    value = await listen(server);
  await new Promise<void>((r) => server.close(() => r()));
  return value;
}
test("real Xray accepts Reality/Vision and gRPC configurations and proxies certificate-verified HTTPS", async () => {
  assert.ok(xray, "Set V2MODERN_TEST_XRAY to a verified Xray binary");
  const dir = await mkdtemp(join(tmpdir(), "v2-xray-"));
  let upstream: ChildProcess | undefined,
    manager: CoreManager | undefined,
    fixture: https.Server | undefined;
  try {
    const { stdout: keys } = await run(xray, ["x25519"]);
    const publicKey = keys.match(
      /(?:Password \(PublicKey\)|PublicKey):\s*(\S+)/,
    )?.[1];
    assert.ok(publicKey);
    const reality = parseLink(
      `vless://e968cd1d-173e-4a86-9cfc-b57bb7deea54@test.example:443?security=reality&type=tcp&pbk=${publicKey}&sid=abcd&sni=www.example.com&flow=xtls-rprx-vision`,
    );
    const settings = {
      ...defaults().settings,
      kernel: "xray" as const,
      xrayPath: xray,
      systemProxy: false,
    };
    for (const node of [
      reality,
      parseLink(
        "vless://e968cd1d-173e-4a86-9cfc-b57bb7deea54@test.example:443?security=tls&type=grpc&serviceName=test",
      ),
    ]) {
      const path = join(dir, "validate.json");
      await writeFile(path, JSON.stringify(generateConfig(node, settings)));
      const { stdout } = await run(xray, ["run", "-test", "-config", path]);
      assert.match(stdout, /Configuration OK/);
    }
    await run("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, "key.pem"),
      "-out",
      join(dir, "cert.pem"),
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
      "-days",
      "1",
    ]);
    const certificate = await readFile(join(dir, "cert.pem"));
    fixture = https.createServer(
      { key: await readFile(join(dir, "key.pem")), cert: certificate },
      (_req, res) => res.end("xray-verified-tls-ok"),
    );
    const destination = await listen(fixture),
      upstreamPort = await port();
    const config = join(dir, "upstream.json");
    await writeFile(
      config,
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
    upstream = spawn(xray, ["run", "-config", config], { stdio: "ignore" });
    const httpPort = await port(),
      socksPort = await port();
    manager = new CoreManager(join(dir, "client"), xray, {
      enable: async () => {
        throw new Error("System proxy must remain disabled in this test");
      },
      restore: async () => {},
    });
    const node = nodeSchema.parse({
      id: "xray-fixture",
      name: "Xray fixture",
      protocol: "socks",
      address: "127.0.0.1",
      port: upstreamPort,
    });
    await manager.connect(node, { ...settings, httpPort, socksPort });
    assert.equal(manager.connection.status, "connected");
    const body = await new Promise<string>((resolve, reject) => {
      const request = http.request({
        host: "127.0.0.1",
        port: httpPort,
        method: "CONNECT",
        path: `127.0.0.1:${destination}`,
      });
      request.setTimeout(5000, () =>
        request.destroy(new Error("CONNECT timeout")),
      );
      request.on("connect", (response, socket) => {
        if (response.statusCode !== 200) {
          socket.destroy();
          reject(new Error("CONNECT rejected"));
          return;
        }
        const encrypted = tls.connect({
          socket,
          ca: certificate,
          servername: "localhost",
        });
        let text = "";
        encrypted.setTimeout(5000, () =>
          encrypted.destroy(new Error("TLS timeout")),
        );
        encrypted.once("secureConnect", () => {
          if (!encrypted.authorized) {
            encrypted.destroy();
            reject(new Error("Certificate validation failed"));
            return;
          }
          encrypted.write(
            `GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
          );
        });
        encrypted.on("data", (chunk) => {
          text += chunk;
          if (text.includes("xray-verified-tls-ok")) {
            encrypted.destroy();
            resolve(text);
          }
        });
        encrypted.on("error", reject);
      });
      request.on("error", reject);
      request.end();
    });
    assert.match(body, /HTTP\/1.1 200/);
    assert.match(body, /xray-verified-tls-ok/);
    await manager.disconnect();
    assert.equal(manager.connection.status, "disconnected");
  } finally {
    await manager?.disconnect();
    if (upstream && upstream.exitCode === null)
      await new Promise<void>((r) => {
        upstream!.once("exit", () => r());
        upstream!.kill();
      });
    if (fixture) await new Promise<void>((r) => fixture!.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
