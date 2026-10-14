import { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import net from "node:net";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { Connection, ProxyNode, Settings } from "../shared/model";
import { generateConfig } from "./config";
import { ProxyControl } from "./system-proxy";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export function redact(text: string, n?: ProxyNode): string {
  let value = text.replace(
    /(?:vmess|vless|trojan|ss):\/\/\S+/gi,
    "[节点凭据已隐藏]",
  );
  value = value.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "[UUID 已隐藏]",
  );
  for (const secret of [n?.uuid, n?.password, n?.username, n?.publicKey].filter(
    Boolean,
  ) as string[])
    value = value.split(secret).join("[已隐藏]");
  return value.slice(0, 2000);
}
export function captureLines(
  stream: Readable,
  callback: (line: string) => void,
) {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on("line", (line) =>
    callback(line.length > 8192 ? "内核输出过长，已省略" : line),
  );
  return lines;
}
async function freePort(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`本地端口 ${port} 已被占用`)));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
  });
}
async function isListening(port: number) {
  return new Promise<boolean>((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    let done = false;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve(result);
    };
    s.setTimeout(200);
    s.once("connect", () => finish(true));
    s.once("error", () => finish(false));
    s.once("timeout", () => finish(false));
  });
}
export class CoreManager extends EventEmitter {
  connection: Connection = {
    status: "disconnected",
    nodeId: null,
    since: null,
    systemProxy: false,
  };
  private operation: Promise<unknown> = Promise.resolve();
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.operation.then(fn);
    this.operation = task.catch(() => {});
    return task;
  }
  private child: ChildProcess | null = null;
  private configPath: string | null = null;
  private intentional = false;
  constructor(
    private directory: string,
    private forkPath: string,
    private proxy: ProxyControl,
    private jobHost?: string,
  ) {
    super();
  }
  private set(value: Connection) {
    this.connection = value;
    this.emit("change");
  }
  private log(text: string, n?: ProxyNode) {
    this.emit("log", redact(text, n));
  }
  async available(settings: Settings) {
    try {
      await access(
        settings.kernel === "fork" ? this.forkPath : settings.xrayPath,
      );
      return true;
    } catch {
      return false;
    }
  }
  private async validate(executable: string, args: string[], node: ProxyNode) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("内核配置校验超时"));
      }, 10000);
      for (const stream of [child.stdout, child.stderr])
        if (stream)
          captureLines(stream, (line) => {
            output = (output + redact(line, node) + "\n").slice(-6000);
          });
      child.once("error", () => {
        clearTimeout(timer);
        reject(new Error("无法启动内核，请检查可执行文件路径"));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error("内核配置校验失败：" + redact(output, node)));
      });
    });
  }
  connect(node: ProxyNode, settings: Settings) {
    return this.enqueue(() => this.doConnect(node, settings));
  }
  private async doConnect(node: ProxyNode, settings: Settings) {
    const config = generateConfig(node, settings);
    const executable =
      settings.kernel === "fork" ? this.forkPath : settings.xrayPath;
    if (!executable || !(await this.available(settings)))
      throw new Error("内核文件不存在，请构建内置内核或选择 Xray 可执行文件");
    await this.doDisconnect();
    this.set({
      status: "connecting",
      nodeId: node.id,
      since: null,
      systemProxy: false,
    });
    try {
      await Promise.all([
        freePort(settings.httpPort),
        freePort(settings.socksPort),
      ]);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      this.configPath = join(this.directory, "active-config.json");
      await writeFile(this.configPath, JSON.stringify(config), { mode: 0o600 });
      const args =
        settings.kernel === "fork"
          ? ["-config", this.configPath]
          : ["run", "-config", this.configPath];
      await this.validate(
        executable,
        settings.kernel === "fork"
          ? ["-test", ...args]
          : ["run", "-test", "-config", this.configPath],
        node,
      );
      this.intentional = false;
      const child = spawn(
        this.jobHost || executable,
        this.jobHost ? [String(process.pid), executable, ...args] : args,
        {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            V2RAY_LOCATION_ASSET: join(this.forkPath, ".."),
          },
        },
      );
      this.child = child;
      let startupError = false;
      child.on("error", () => {
        startupError = true;
      });
      for (const stream of [child.stdout, child.stderr])
        if (stream)
          captureLines(stream, (line) => {
            if (line) this.log(line, node);
          });
      child.once("exit", () => {
        if (!this.intentional && this.connection.status !== "disconnected")
          void this.unexpectedExit(child);
      });
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (
          startupError ||
          child.exitCode !== null ||
          child.signalCode !== null
        )
          throw new Error("内核启动失败，请查看日志");
        if (
          (await isListening(settings.httpPort)) &&
          (await isListening(settings.socksPort))
        ) {
          ready = true;
          break;
        }
        await sleep(100);
      }
      if (!ready) throw new Error("内核启动超时，本地代理未就绪");
      if (settings.systemProxy) {
        await this.proxy.enable(settings.httpPort);
        this.connection = { ...this.connection, systemProxy: true };
      }
      if (startupError || child.exitCode !== null || child.signalCode !== null)
        throw new Error("内核在启动期间退出");
      this.set({
        status: "connected",
        nodeId: node.id,
        since: Date.now(),
        systemProxy: settings.systemProxy,
      });
      this.log(
        `已连接 ${node.name} · ${settings.kernel === "fork" ? "v2Modern" : "Xray"}`,
      );
    } catch (error) {
      const message = redact(
        error instanceof Error ? error.message : "连接失败",
        node,
      );
      let recovered = true;
      try {
        await this.doDisconnect();
      } catch {
        recovered = false;
        this.log("清理失败，请检查 Windows 系统代理设置后重试断开");
      }
      this.set({
        status: "error",
        nodeId: node.id,
        since: null,
        error: recovered ? message : message + "；系统代理恢复失败，请手动检查",
        systemProxy: !recovered && settings.systemProxy,
      });
      throw new Error(this.connection.error);
    }
  }
  private unexpectedExit(child: ChildProcess) {
    return this.enqueue(async () => {
      if (this.child !== child) return;
      this.log("内核意外退出，正在恢复系统代理");
      try {
        await this.doDisconnect();
        this.set({
          status: "error",
          nodeId: null,
          since: null,
          error: "内核意外退出，请查看日志",
          systemProxy: false,
        });
      } catch {
        this.set({
          status: "error",
          nodeId: null,
          since: null,
          error: "代理恢复失败，请手动检查 Windows 代理设置",
          systemProxy: true,
        });
      }
    });
  }
  disconnect() {
    return this.enqueue(() => this.doDisconnect());
  }
  private async doDisconnect() {
    this.intentional = true;
    // Restore proxy before terminating the listener to avoid leaving a broken proxy.
    try {
      await this.proxy.restore();
    } catch {
      this.intentional = false;
      this.set({
        ...this.connection,
        status: "error",
        error: "系统代理恢复失败，请检查 Windows 代理设置后重试",
      });
      throw new Error("系统代理恢复失败，请检查 Windows 代理设置后重试");
    }
    if (this.child) {
      const child = this.child;
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 3000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
          child.kill();
        });
      }
      this.child = null;
    }
    if (this.configPath) {
      await unlink(this.configPath).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
      this.configPath = null;
    }
    this.set({
      status: "disconnected",
      nodeId: null,
      since: null,
      systemProxy: false,
    });
  }
}
