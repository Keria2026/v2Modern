import {
  nodeSchema,
  ProxyNode,
  Settings,
  settingsSchema,
} from "../shared/model";
export function generateConfig(input: ProxyNode, rawSettings: Settings) {
  const n = nodeSchema.parse(input),
    s = settingsSchema.parse(rawSettings);
  if (
    s.kernel === "fork" &&
    (n.security === "reality" ||
      n.flow === "xtls-rprx-vision" ||
      n.transport === "grpc")
  )
    throw new Error(
      "此 fork 不支持 Reality、Vision 或 gRPC，请在设置中选择 Xray",
    );
  if (
    n.flow &&
    (n.protocol !== "vless" ||
      n.flow !== "xtls-rprx-vision" ||
      n.security === "none" ||
      n.transport !== "tcp")
  )
    throw new Error("首版仅支持 Xray 的 VLESS + TCP + TLS/Reality Vision");
  if (n.security === "reality" && n.transport !== "tcp")
    throw new Error("首版 Reality 仅支持 TCP");
  if (
    ["socks", "http", "ss"].includes(n.protocol) &&
    (n.transport !== "tcp" || n.security !== "none")
  )
    throw new Error("该协议在首版仅支持原生 TCP，无额外 TLS");
  const stream: Record<string, unknown> = {
    network: n.transport,
    security: n.security,
  };
  if (n.transport === "ws")
    stream.wsSettings = {
      path: n.path,
      headers: n.host ? { Host: n.host } : {},
    };
  if (n.transport === "grpc")
    stream.grpcSettings = { serviceName: n.serviceName };
  if (n.security === "tls")
    stream.tlsSettings = {
      serverName: n.sni || n.address,
      allowInsecure: false,
    };
  if (n.security === "reality")
    stream.realitySettings = {
      serverName: n.sni || n.address,
      fingerprint: n.fingerprint,
      publicKey: n.publicKey,
      shortId: n.shortId,
    };
  let protocol: string = n.protocol,
    settings: unknown;
  switch (n.protocol) {
    case "vmess":
      settings = {
        vnext: [
          {
            address: n.address,
            port: n.port,
            users: [{ id: n.uuid, alterId: n.alterId, security: n.cipher }],
          },
        ],
      };
      break;
    case "vless":
      settings = {
        vnext: [
          {
            address: n.address,
            port: n.port,
            users: [{ id: n.uuid, encryption: "none", flow: n.flow }],
          },
        ],
      };
      break;
    case "trojan":
      settings = {
        servers: [{ address: n.address, port: n.port, password: n.password }],
      };
      break;
    case "ss":
      protocol = "shadowsocks";
      settings = {
        servers: [
          {
            address: n.address,
            port: n.port,
            method: n.cipher,
            password: n.password,
          },
        ],
      };
      break;
    default:
      settings = {
        servers: [
          {
            address: n.address,
            port: n.port,
            ...(n.username
              ? { users: [{ user: n.username, pass: n.password }] }
              : {}),
          },
        ],
      };
  }
  return {
    log: { loglevel: "warning" },
    inbounds: [
      {
        tag: "socks-in",
        listen: "127.0.0.1",
        port: s.socksPort,
        protocol: "socks",
        settings: { auth: "noauth", udp: true },
      },
      {
        tag: "http-in",
        listen: "127.0.0.1",
        port: s.httpPort,
        protocol: "http",
        settings: {},
      },
    ],
    outbounds: [{ tag: "proxy", protocol, settings, streamSettings: stream }],
  };
}
