import test from "node:test";
import assert from "node:assert/strict";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import http from "node:http";
import net from "node:net";
import { CoreManager } from "../src/main/core-manager";
import { defaults, nodeSchema } from "../src/shared/model";
const binary = process.env.V2MODERN_TEST_CORE;
async function listen(server: net.Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}
async function port() {
  const server = net.createServer(),
    value = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return value;
}
async function wait(port: number, child: ChildProcess) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("Fixture core exited");
    const ready = await new Promise<boolean>((resolve) => {
      const s = net.connect(port, "127.0.0.1");
      s.once("connect", () => {
        s.destroy();
        resolve(true);
      });
      s.once("error", () => resolve(false));
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Fixture timeout");
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill();
  });
}
test("real fork validates, proxies HTTP and CONNECT, restores on disconnect and crash", async () => {
  assert.ok(binary, "Set V2MODERN_TEST_CORE to the compiled fork binary");
  const dir = await mkdtemp(join(tmpdir(), "v2-core-"));
  const fixture = http.createServer((_req, res) =>
    res.end("v2modern-real-proxy-ok"),
  );
  let upstream: ChildProcess | undefined, manager: CoreManager | undefined;
  try {
    const destination = await listen(fixture),
      upstreamPort = await port(),
      httpPort = await port(),
      socksPort = await port();
    const configPath = join(dir, "upstream.json");
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
    await wait(upstreamPort, upstream);
    let enabled = 0,
      restored = 0;
    manager = new CoreManager(
      join(dir, "client"),
      binary,
      {
        enable: async () => {
          enabled++;
        },
        restore: async () => {
          restored++;
        },
      },
      process.platform === "win32"
        ? join(dirname(binary), "jobhost.exe")
        : undefined,
    );
    const n = nodeSchema.parse({
      id: "fixture",
      name: "Local SOCKS fixture",
      protocol: "socks",
      address: "127.0.0.1",
      port: upstreamPort,
    });
    const settings = { ...defaults().settings, httpPort, socksPort };
    await manager.connect(n, settings);
    assert.equal(manager.connection.status, "connected");
    assert.equal(enabled, 1);
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port: httpPort,
          path: `http://127.0.0.1:${destination}/fixture`,
          agent: false,
          headers: {
            Host: `127.0.0.1:${destination}`,
            "Proxy-Connection": "keep-alive",
          },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve(body));
        },
      );
      req.on("error", reject);
      req.setTimeout(5000, () => req.destroy(new Error("HTTP timeout")));
    });
    assert.equal(body, "v2modern-real-proxy-ok");
    const tunnelBody = await new Promise<string>((resolve, reject) => {
      const request = http.request({
        host: "127.0.0.1",
        port: httpPort,
        method: "CONNECT",
        path: `127.0.0.1:${destination}`,
      });
      request.on("connect", (response, socket, head) => {
        if (response.statusCode !== 200) {
          socket.destroy();
          reject(new Error("CONNECT rejected"));
          return;
        }
        let content = head.toString();
        socket.setTimeout(5000, () =>
          socket.destroy(new Error("CONNECT timeout")),
        );
        socket.on("data", (chunk) => (content += chunk));
        socket.on("end", () => resolve(content));
        socket.on("error", reject);
        socket.write(
          `GET /tunnel HTTP/1.1\r\nHost: 127.0.0.1:${destination}\r\nConnection: close\r\n\r\n`,
        );
      });
      request.on("error", reject);
      request.end();
    });
    assert.match(tunnelBody, /v2modern-real-proxy-ok/);
    await manager.disconnect();
    assert.equal(manager.connection.status, "disconnected");
    assert.ok(restored >= 2);
    await assert.rejects(() =>
      readFile(join(dir, "client", "active-config.json")),
    );
    await manager.connect(n, settings);
    const event = new Promise<void>((resolve) => {
      const handler = () => {
        if (manager!.connection.status === "error") {
          manager!.off("change", handler);
          resolve();
        }
      };
      manager!.on("change", handler);
    });
    // Kill the actual managed core to verify crash cleanup, not merely a mocked status.
    const child = (manager as unknown as { child: ChildProcess }).child;
    child.kill();
    await Promise.race([
      event,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Crash cleanup timeout")), 5000),
      ),
    ]);
    assert.equal(manager.connection.systemProxy, false);
  } finally {
    await manager?.disconnect();
    if (upstream) await stop(upstream);
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
test("occupied listener prevents connection and never enables system proxy", async () => {
  assert.ok(binary);
  const dir = await mkdtemp(join(tmpdir(), "v2-port-"));
  const occupied = net.createServer();
  const httpPort = await listen(occupied);
  let enabled = 0;
  const manager = new CoreManager(dir, binary, {
    enable: async () => {
      enabled++;
    },
    restore: async () => {},
  });
  try {
    const n = nodeSchema.parse({
      id: "a",
      name: "a",
      protocol: "socks",
      address: "127.0.0.1",
      port: 10000,
    });
    const socksPort = await port();
    await assert.rejects(
      () => manager.connect(n, { ...defaults().settings, httpPort, socksPort }),
      /占用/,
    );
    assert.equal(enabled, 0);
    assert.equal(manager.connection.status, "error");
  } finally {
    await manager.disconnect();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("fork validates generated VMess, VLESS, Trojan and Shadowsocks configurations", async () => {
  assert.ok(binary);
  const directory = await mkdtemp(join(tmpdir(), "v2-config-"));
  const { promisify } = await import("node:util");
  const { execFile } = await import("node:child_process");
  const { generateConfig } = await import("../src/main/config");
  const run = promisify(execFile);
  try {
    const common = {
      id: "validation",
      name: "Config validation",
      address: "server.example",
      port: 443,
      uuid: "e968cd1d-173e-4a86-9cfc-b57bb7deea54",
    };
    const inputs = [
      { ...common, protocol: "vmess", security: "tls", transport: "tcp" },
      {
        ...common,
        protocol: "vmess",
        security: "tls",
        transport: "ws",
        path: "/ws",
        host: "ws.example",
      },
      { ...common, protocol: "vless", security: "tls", transport: "tcp" },
      { ...common, protocol: "vless", security: "tls", transport: "ws" },
      {
        ...common,
        protocol: "trojan",
        password: "test-password",
        security: "tls",
      },
      ...["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"].map(
        (cipher) => ({
          ...common,
          protocol: "ss",
          cipher,
          password: "test-password",
        }),
      ),
    ];
    for (const input of inputs) {
      const config = join(directory, "config.json");
      await writeFile(
        config,
        JSON.stringify(
          generateConfig(nodeSchema.parse(input), defaults().settings),
        ),
      );
      const { stdout } = await run(binary, ["-test", "-config", config]);
      assert.match(stdout, /Configuration OK/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "Windows job host terminates the core when the Electron parent disappears",
  { skip: process.platform !== "win32" },
  async () => {
    assert.ok(binary);
    const directory = await mkdtemp(join(tmpdir(), "v2-job-"));
    const httpPort = await port();
    const configPath = join(directory, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        log: { loglevel: "error" },
        inbounds: [
          {
            listen: "127.0.0.1",
            port: httpPort,
            protocol: "http",
            settings: {},
          },
        ],
        outbounds: [{ protocol: "freedom", settings: {} }],
      }),
    );
    const parent = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      stdio: "ignore",
    });
    assert.ok(parent.pid);
    const helper = spawn(
      join(dirname(binary), "jobhost.exe"),
      [String(parent.pid), binary, "-config", configPath],
      { stdio: "ignore" },
    );
    try {
      await wait(httpPort, helper);
      const closed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Job host did not stop after parent exit")),
          5000,
        );
        helper.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      parent.kill();
      await closed;
      const reachable = await new Promise<boolean>((resolve) => {
        const socket = net.connect(httpPort, "127.0.0.1");
        socket.on("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.on("error", () => resolve(false));
      });
      assert.equal(reachable, false);
    } finally {
      if (parent.exitCode === null) parent.kill();
      if (helper.exitCode === null) await stop(helper);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
