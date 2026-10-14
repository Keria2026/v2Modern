import { z } from "zod";
const port = z.number().int().min(1).max(65535);
export const nodeSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(120),
    protocol: z.enum(["vmess", "vless", "trojan", "ss", "socks", "http"]),
    address: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .refine((v) => !/[\s/\\@]/.test(v), "服务器地址不能包含路径或空格"),
    port,
    uuid: z.string().max(100).default(""),
    password: z.string().max(1000).default(""),
    username: z.string().max(120).default(""),
    alterId: z.number().int().min(0).max(65535).default(0),
    cipher: z.string().max(80).default("auto"),
    transport: z.enum(["tcp", "ws", "grpc"]).default("tcp"),
    security: z.enum(["none", "tls", "reality"]).default("none"),
    sni: z.string().max(253).default(""),
    host: z.string().max(253).default(""),
    path: z.string().max(500).default("/"),
    serviceName: z.string().max(200).default(""),
    flow: z.string().max(80).default(""),
    publicKey: z.string().max(120).default(""),
    shortId: z.string().max(32).default(""),
    fingerprint: z.string().max(40).default("chrome"),
    subscriptionId: z.string().max(100).optional(),
  })
  .superRefine((n, ctx) => {
    if (
      ["vmess", "vless"].includes(n.protocol) &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        n.uuid,
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["uuid"],
        message: "请输入有效 UUID",
      });
    if (["trojan", "ss"].includes(n.protocol) && !n.password)
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "密码不能为空",
      });
    if (
      n.protocol === "vmess" &&
      !["auto", "aes-128-gcm", "chacha20-poly1305", "none"].includes(n.cipher)
    )
      ctx.addIssue({
        code: "custom",
        path: ["cipher"],
        message: "不支持的 VMess 加密方式",
      });
    if (
      n.protocol === "ss" &&
      !["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"].includes(
        n.cipher,
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["cipher"],
        message: "首版 Shadowsocks 支持 AES-GCM / ChaCha20-Poly1305",
      });
    if (n.security === "reality" && (n.protocol !== "vless" || !n.publicKey))
      ctx.addIssue({
        code: "custom",
        path: ["publicKey"],
        message: "Reality 需要 VLESS 与公钥",
      });
  });
export type ProxyNode = z.infer<typeof nodeSchema>;
export const subscriptionSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(120),
  url: z
    .string()
    .url()
    .max(2048)
    .refine((v) => new URL(v).protocol === "https:", "订阅必须使用 HTTPS"),
  updatedAt: z.string().optional(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;
export const settingsSchema = z
  .object({
    kernel: z.enum(["fork", "xray"]).default("fork"),
    xrayPath: z.string().max(1000).default(""),
    httpPort: port.default(10809),
    socksPort: port.default(10808),
    systemProxy: z.boolean().default(true),
    theme: z.enum(["system", "light", "dark"]).default("system"),
    reduceTransparency: z.boolean().default(false),
    reduceMotion: z.boolean().default(false),
  })
  .refine((v) => v.httpPort !== v.socksPort, "HTTP 与 SOCKS 端口不能相同");
export type Settings = z.infer<typeof settingsSchema>;
export interface SavedState {
  nodes: ProxyNode[];
  subscriptions: Subscription[];
  settings: Settings;
  selectedId: string | null;
}
export interface Connection {
  status:
    | "disconnected"
    | "connecting"
    | "connected"
    | "disconnecting"
    | "error";
  nodeId: string | null;
  since: number | null;
  error?: string;
  systemProxy: boolean;
}
export interface Snapshot extends SavedState {
  connection: Connection;
  logs: LogEntry[];
  kernelAvailable: boolean;
  platform: string;
  version: string;
  storageSecure: boolean;
  materialAvailable: boolean;
  systemReduceTransparency: boolean;
}
export interface LogEntry {
  id: number;
  time: string;
  level: "info" | "error";
  message: string;
}
export type Action =
  | { type: "import"; text: string }
  | { type: "save-node"; node: ProxyNode }
  | { type: "delete-node"; id: string }
  | { type: "select"; id: string }
  | { type: "save-subscription"; subscription: Subscription }
  | { type: "delete-subscription"; id: string }
  | { type: "update-subscription"; id: string }
  | { type: "settings"; settings: Settings }
  | { type: "connect"; id: string }
  | { type: "disconnect" }
  | { type: "clear-logs" };
export interface DesktopAPI {
  snapshot(): Promise<Snapshot>;
  action(action: Action): Promise<Snapshot>;
  chooseXray(): Promise<string | null>;
  onSnapshot(callback: (state: Snapshot) => void): () => void;
  window(action: "minimize" | "maximize" | "close"): void;
}
export const defaults = (): SavedState => ({
  nodes: [],
  subscriptions: [],
  settings: settingsSchema.parse({}),
  selectedId: null,
});
