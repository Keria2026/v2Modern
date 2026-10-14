import { randomUUID } from "node:crypto";
import { nodeSchema, ProxyNode } from "../shared/model";
function decode(value: string): string {
  if (!/^[A-Za-z0-9+/_=-]+$/.test(value)) throw new Error("无效 Base64 编码");
  return Buffer.from(
    value.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}
export function parseLink(link: string): ProxyNode {
  if (link.startsWith("vmess://")) {
    const v = JSON.parse(decode(link.slice(8)));
    if (v.type && !["none", ""].includes(v.type))
      throw new Error("暂不支持 VMess TCP 伪装");
    if (v.tls && v.tls !== "tls") throw new Error("不支持的 VMess 安全类型");
    return nodeSchema.parse({
      id: randomUUID(),
      name: v.ps || v.add,
      protocol: "vmess",
      address: v.add,
      port: Number(v.port),
      uuid: v.id,
      alterId: Number(v.aid || 0),
      cipher: v.scy || "auto",
      transport: v.net || "tcp",
      security: v.tls === "tls" ? "tls" : "none",
      host: v.host || "",
      sni: v.sni || v.host || "",
      path: v.path || "/",
    });
  }
  if (link.startsWith("ss://")) {
    const fragment = link.indexOf("#");
    const name =
      fragment < 0
        ? "Shadowsocks"
        : decodeURIComponent(link.slice(fragment + 1));
    let body = link.slice(5, fragment < 0 ? undefined : fragment);
    if (!body.includes("@")) body = decode(body);
    const url = new URL("ss://" + body);
    if (url.searchParams.has("plugin"))
      throw new Error("首版不支持 Shadowsocks 插件");
    let auth =
      decodeURIComponent(url.username) +
      (url.password ? ":" + decodeURIComponent(url.password) : "");
    if (!auth.includes(":")) auth = decode(auth);
    const index = auth.indexOf(":");
    if (index < 1) throw new Error("Shadowsocks 凭据无效");
    return nodeSchema.parse({
      id: randomUUID(),
      name,
      protocol: "ss",
      address: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port),
      cipher: auth.slice(0, index),
      password: auth.slice(index + 1),
    });
  }
  const url = new URL(link);
  const protocol = url.protocol.slice(0, -1);
  if (!["vless", "trojan", "socks", "http"].includes(protocol))
    throw new Error("不支持的节点链接协议");
  const q = url.searchParams;
  const supported = new Set([
    "type",
    "security",
    "sni",
    "peer",
    "host",
    "path",
    "serviceName",
    "flow",
    "pbk",
    "sid",
    "fp",
    "encryption",
  ]);
  for (const key of q.keys())
    if (!supported.has(key)) throw new Error(`不支持的链接参数：${key}`);
  if (q.has("encryption") && q.get("encryption") !== "none")
    throw new Error("VLESS 仅支持 encryption=none");
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  return nodeSchema.parse({
    id: randomUUID(),
    name: decodeURIComponent(url.hash.slice(1)) || url.hostname,
    protocol,
    address: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port) || (protocol === "http" ? 80 : 443),
    uuid: protocol === "vless" ? user : "",
    password: protocol === "trojan" ? user : password,
    username: ["http", "socks"].includes(protocol) ? user : "",
    transport: q.get("type") || "tcp",
    security: q.get("security") || (protocol === "trojan" ? "tls" : "none"),
    sni: q.get("sni") || q.get("peer") || "",
    host: q.get("host") || "",
    path: q.get("path") || "/",
    serviceName: q.get("serviceName") || "",
    flow: q.get("flow") || "",
    publicKey: q.get("pbk") || "",
    shortId: q.get("sid") || "",
    fingerprint: q.get("fp") || "chrome",
  });
}
export function parseProfiles(text: string): ProxyNode[] {
  if (Buffer.byteLength(text) > 2 * 1024 * 1024)
    throw new Error("节点数据不能超过 2 MB");
  let content = text.trim();
  if (!content) throw new Error("请输入节点链接");
  if (!content.includes("://")) content = decode(content).trim();
  const lines = content
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
  if (lines.length > 2000) throw new Error("单次最多导入 2000 个节点");
  // Atomic import: unsupported or malformed lines never silently disappear.
  return lines.map((line, index) => {
    try {
      return parseLink(line);
    } catch {
      throw new Error(
        `第 ${index + 1} 个节点无效或包含不支持的参数，请检查协议、UUID、传输和加密配置`,
      );
    }
  });
}
