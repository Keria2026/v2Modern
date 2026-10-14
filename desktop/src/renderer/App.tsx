import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CloudDownload,
  Code2,
  Globe2,
  Layers3,
  LoaderCircle,
  Maximize2,
  Minus,
  Moon,
  Plus,
  Power,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type {
  Action,
  ProxyNode,
  Settings,
  Snapshot,
  Subscription,
} from "../shared/model";
import { nodeSchema } from "../shared/model";
type Page = "overview" | "nodes" | "subscriptions" | "logs" | "settings";
type Modal =
  | { type: "import" }
  | { type: "node"; node?: ProxyNode }
  | { type: "subscription"; subscription?: Subscription }
  | { type: "delete-node"; node: ProxyNode }
  | { type: "delete-subscription"; subscription: Subscription };
const navigation = [
  { id: "overview", label: "概览", icon: Layers3 },
  { id: "nodes", label: "节点", icon: Globe2 },
  { id: "subscriptions", label: "订阅", icon: CloudDownload },
  { id: "logs", label: "连接日志", icon: Terminal },
  { id: "settings", label: "设置", icon: Settings2 },
] as const;
const statusLabels = {
  disconnected: "尚未连接",
  connecting: "正在连接",
  connected: "连接已建立",
  disconnecting: "正在断开",
  error: "连接失败",
};
const uuid = () => crypto.randomUUID();
function duration(since: number | null, now: number) {
  if (!since) return "—";
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
function protocolName(node: ProxyNode) {
  return node.protocol === "ss" ? "Shadowsocks" : node.protocol.toUpperCase();
}
function needsXray(node: ProxyNode) {
  return (
    node.security === "reality" ||
    node.transport === "grpc" ||
    node.flow === "xtls-rprx-vision"
  );
}
export default function App() {
  const [state, setState] = useState<Snapshot | null>(null),
    [page, setPage] = useState<Page>("overview"),
    [modal, setModal] = useState<Modal | null>(null),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState<{ text: string; error: boolean } | null>(null),
    [query, setQuery] = useState(""),
    [now, setNow] = useState(Date.now()),
    [darkSystem, setDarkSystem] = useState(
      matchMedia("(prefers-color-scheme: dark)").matches,
    ),
    [fatal, setFatal] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [page]);
  const pending = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!window.desktop) {
      setFatal("请通过 Electron 桌面应用启动，浏览器页面无法访问内核。");
      return;
    }
    void window.desktop
      .snapshot()
      .then(setState)
      .catch(() => setFatal("读取客户端状态失败，请重新启动应用。"));
    return window.desktop.onSnapshot(setState);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDarkSystem(media.matches);
    media.addEventListener("change", update);
    return () => {
      clearInterval(timer);
      media.removeEventListener("change", update);
      clearTimeout(toastTimer.current);
    };
  }, []);
  function notify(text: string, error = false) {
    setToast({ text, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 10000 : 4000);
  }
  async function run(action: Action, success?: string) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    try {
      setState(await window.desktop.action(action));
      if (success) notify(success);
      return true;
    } catch (error) {
      notify(
        (error instanceof Error ? error.message : "操作失败").replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
        true,
      );
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (!state)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <Layers3 size={28} />
        </div>
        {fatal ? (
          <p role="alert">{fatal}</p>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>正在准备 V2 Modern…</p>
          </>
        )}
      </div>
    );
  const dark =
    state.settings.theme === "dark" ||
    (state.settings.theme === "system" && darkSystem);
  const selected = state.nodes.find((n) => n.id === state.selectedId),
    active = state.nodes.find((n) => n.id === state.connection.nodeId);
  const connected = state.connection.status === "connected";
  const current = active || selected;
  const filtered = state.nodes.filter((n) =>
    `${n.name} ${n.address} ${n.protocol}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const title = navigation.find((n) => n.id === page)!;
  async function connect() {
    if (connected && selected?.id === state!.connection.nodeId)
      await run({ type: "disconnect" });
    else if (selected) await run({ type: "connect", id: selected.id });
    else setModal({ type: "import" });
  }
  const openImport = () => setModal({ type: "import" });
  function nodeList(compact = false) {
    return (
      <div className="node-list">
        <div className="table-heading">
          <span>节点名称</span>
          <span>协议 / 传输</span>
          <span>状态</span>
          <span />
        </div>
        {(compact ? filtered.slice(0, 5) : filtered).map((node) => (
          <div
            key={node.id}
            className={`node-row ${state!.selectedId === node.id ? "selected" : ""}`}
          >
            <button
              className="node-select"
              onClick={() => void run({ type: "select", id: node.id })}
              disabled={busy}
              aria-pressed={state!.selectedId === node.id}
            >
              <span className="node-avatar">
                <Globe2 size={19} />
              </span>
              <span>
                <strong>{node.name}</strong>
                <small>
                  {node.address}:{node.port}
                </small>
              </span>
            </button>
            <span className="protocol-cell">
              <span className="protocol-tag">{protocolName(node)}</span>
              <small>
                {node.transport.toUpperCase()}{" "}
                {node.security !== "none" && `· ${node.security.toUpperCase()}`}
              </small>
            </span>
            <span className="node-state">
              {state!.connection.status === "connected" &&
              state!.connection.nodeId === node.id ? (
                <>
                  <span className="status-dot" />
                  已连接
                </>
              ) : needsXray(node) && state!.settings.kernel === "fork" ? (
                <span className="xray-required">需 Xray</span>
              ) : state!.selectedId === node.id ? (
                <>
                  <Check size={14} />
                  已选择
                </>
              ) : (
                <span className="muted">待连接</span>
              )}
            </span>
            <div className="row-actions">
              <button
                className="icon-button"
                title={`编辑 ${node.name}`}
                aria-label={`编辑 ${node.name}`}
                onClick={() => setModal({ type: "node", node })}
                disabled={busy}
              >
                <SlidersHorizontal size={16} />
              </button>
              <button
                className="icon-button"
                title={`删除 ${node.name}`}
                aria-label={`删除 ${node.name}`}
                onClick={() => setModal({ type: "delete-node", node })}
                disabled={busy}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        {!filtered.length && (
          <div className="empty-state">
            <div className="empty-icon">
              <Globe2 size={30} />
            </div>
            <h3>
              {state!.nodes.length
                ? "没有找到匹配节点"
                : "连接，从一个节点开始"}
            </h3>
            <p>
              {state!.nodes.length
                ? "试试节点名称、服务器地址或协议。"
                : "导入节点链接或添加订阅，开启你的第一段连接。"}
            </p>
            {!state!.nodes.length && (
              <button className="primary-button" onClick={openImport}>
                <Plus size={16} />
                导入节点
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      className={`app ${dark ? "dark" : "light"} ${state.settings.reduceTransparency || state.systemReduceTransparency ? "opaque" : state.materialAvailable ? "native-glass" : ""} ${state.settings.reduceMotion ? "reduce-motion" : ""}`}
    >
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="ambient ambient-three" />
      <aside className="sidebar glass">
        <div className="brand">
          <div className="brand-mark">
            <Layers3 size={24} />
          </div>
          <span>
            V2 Modern<small>简单连接，自在探索</small>
          </span>
        </div>
        <div className="sidebar-label">工作空间</div>
        <nav aria-label="主导航">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              onClick={() => {
                setPage(item.id);
                setQuery("");
              }}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === "nodes" && state.nodes.length > 0 && (
                <span className="nav-count">{state.nodes.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="kernel-card">
            <div className="kernel-symbol">
              <Code2 size={19} />
            </div>
            <div>
              <strong>
                {state.settings.kernel === "fork"
                  ? "v2Modern Core"
                  : "Xray Core"}
              </strong>
              <small>
                <span
                  className={`tiny-dot ${state.kernelAvailable ? "ready" : ""}`}
                />
                {state.kernelAvailable ? "内核已就绪" : "等待配置内核"}
              </small>
            </div>
          </div>
          <div className="sidebar-footer">
            <span>桌面客户端 · {state.version}</span>
            <button
              className="icon-button"
              title="切换深浅色主题"
              aria-label="切换深浅色主题"
              disabled={busy}
              onClick={() =>
                void run({
                  type: "settings",
                  settings: {
                    ...state.settings,
                    theme: dark ? "light" : "dark",
                  },
                })
              }
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="titlebar">
          <div className="breadcrumb">
            <span>我的工作空间</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{title.label}</strong>
          </div>
          <div className="window-controls">
            <button
              aria-label="最小化"
              onClick={() => window.desktop.window("minimize")}
            >
              <Minus size={15} />
            </button>
            <button
              aria-label="最大化或还原"
              onClick={() => window.desktop.window("maximize")}
            >
              <Maximize2 size={13} />
            </button>
            <button
              className="close-window"
              aria-label="关闭到托盘"
              title="关闭到托盘；右键托盘可退出"
              onClick={() => window.desktop.window("close")}
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <div className="page-content" ref={contentRef}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "overview"
                  ? "YOUR CONNECTION, REIMAGINED"
                  : "V2 MODERN / WORKSPACE"}
              </div>
              <h1>
                {page === "overview" ? "一切连接，尽在掌握。" : title.label}
              </h1>
              <p>
                {page === "overview"
                  ? "让复杂留在背后，让连接回归简单。"
                  : page === "nodes"
                    ? "选择你的下一站，连接更广阔的世界。"
                    : page === "subscriptions"
                      ? "集中管理订阅，让节点保持最新。"
                      : page === "logs"
                        ? "查看内核的真实输出与连接状态。"
                        : "为你的工作空间，找到舒适的节奏。"}
              </p>
            </div>
            {(page === "overview" || page === "nodes") && (
              <button
                className="glass-button"
                onClick={openImport}
                disabled={busy}
              >
                <Plus size={17} />
                导入节点
              </button>
            )}
            {page === "subscriptions" && (
              <button
                className="glass-button"
                onClick={() => setModal({ type: "subscription" })}
              >
                <Plus size={17} />
                添加订阅
              </button>
            )}
          </div>
          {!state.storageSecure && (
            <div className="notice">
              <ShieldCheck size={18} />
              <span>
                系统加密存储不可用：节点与订阅仅在本次会话保留，不会写入明文配置。
              </span>
            </div>
          )}
          {page === "overview" && (
            <>
              <section className="connection-card glass">
                <div className="connection-copy">
                  <div
                    className={`connection-status ${connected ? "online" : ""}`}
                  >
                    <span
                      className={`status-dot ${connected ? "" : "offline"}`}
                    />
                    {statusLabels[state.connection.status]}
                  </div>
                  <h2>
                    {connected ? "世界，就在眼前。" : "准备好，连接世界。"}
                  </h2>
                  <p>
                    {connected
                      ? "你的本地代理已启动，连接由你掌控。"
                      : "选择一个节点，开启流畅而安静的连接体验。"}
                  </p>
                  <div className="connection-node">
                    <span className="node-avatar">
                      <Globe2 size={18} />
                    </span>
                    <div>
                      <strong>{current?.name || "尚未选择节点"}</strong>
                      <small>
                        {current
                          ? `${protocolName(current)} · ${current.transport.toUpperCase()} · ${state.settings.kernel === "fork" ? "v2Modern" : "Xray"}`
                          : "支持 VMess / VLESS / Trojan / Shadowsocks"}
                      </small>
                    </div>
                    <button
                      className="icon-button"
                      title="选择节点"
                      aria-label="选择节点"
                      onClick={() => setPage("nodes")}
                    >
                      <ChevronDown size={17} />
                    </button>
                  </div>
                  <button
                    className={`connect-button ${connected ? "connected" : ""}`}
                    disabled={busy}
                    onClick={() => void connect()}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <Power size={18} />
                    )}
                    <span>
                      {connected && selected?.id === state.connection.nodeId
                        ? "断开连接"
                        : connected
                          ? "切换并连接"
                          : selected
                            ? "连接节点"
                            : "添加第一个节点"}
                    </span>
                    <ArrowRight size={17} />
                  </button>
                  {state.connection.error && (
                    <p className="inline-error" role="alert">
                      {state.connection.error}
                    </p>
                  )}
                </div>
                <div
                  className={`connection-art ${connected ? "online" : ""}`}
                  aria-hidden="true"
                >
                  <div className="orbital orbital-one" />
                  <div className="orbital orbital-two" />
                  <div className="glass-orb">
                    <Globe2 strokeWidth={0.7} size={148} />
                    <div className="orb-shine" />
                  </div>
                  <div className="floating-pill">
                    <span
                      className={`status-dot ${connected ? "" : "offline"}`}
                    />
                    {connected ? "CONNECTED" : "READY WHEN YOU ARE"}
                  </div>
                  <Sparkles className="art-spark" size={22} />
                </div>
              </section>
              <div className="metrics">
                <div className="metric glass">
                  <div className="metric-icon mint">
                    <Activity size={19} />
                  </div>
                  <span>
                    连接时长
                    <strong>{duration(state.connection.since, now)}</strong>
                  </span>
                  <small>{connected ? "本次连接" : "等待连接"}</small>
                </div>
                <div className="metric glass">
                  <div className="metric-icon blue">
                    <ShieldCheck size={19} />
                  </div>
                  <span>
                    系统代理
                    <strong>
                      {state.connection.systemProxy ? "已启用" : "未启用"}
                    </strong>
                  </span>
                  <small>
                    {state.platform === "win32"
                      ? "Windows 用户代理"
                      : "当前为开发平台"}
                  </small>
                </div>
                <div className="metric glass">
                  <div className="metric-icon violet">
                    <Radio size={19} />
                  </div>
                  <span>
                    本地端口
                    <strong>
                      {state.settings.httpPort}
                      <em> / {state.settings.socksPort}</em>
                    </strong>
                  </span>
                  <small>HTTP / SOCKS5</small>
                </div>
              </div>
              <section className="content-card">
                <div className="section-heading">
                  <div>
                    <h3>
                      我的节点{" "}
                      <span className="count-badge">{state.nodes.length}</span>
                    </h3>
                    <p>选择一个节点，随时切换连接。</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setPage("nodes")}
                  >
                    查看全部
                    <ArrowRight size={15} />
                  </button>
                </div>
                {nodeList(true)}
              </section>
              <div className="quiet-footer">
                <ShieldCheck size={14} />
                <span>配置保留在本机 · TLS 证书验证始终开启</span>
                <span className="footer-right">
                  {state.settings.kernel === "fork"
                    ? "v2Modern Core"
                    : "Xray Core"}
                </span>
              </div>
            </>
          )}
          {page === "nodes" && (
            <section className="content-card">
              <div className="list-toolbar">
                <label className="search-box">
                  <Search size={17} />
                  <input
                    aria-label="搜索节点"
                    placeholder="搜索名称、地址或协议…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <span className="muted">{filtered.length} 个节点</span>
                <button
                  className="subtle-button"
                  onClick={() => setModal({ type: "node" })}
                >
                  <Plus size={16} />
                  手动添加
                </button>
                <button
                  className="primary-button"
                  disabled={busy || !selected}
                  onClick={() => void connect()}
                >
                  <Power size={16} />
                  {connected && selected?.id === state.connection.nodeId
                    ? "断开"
                    : "连接所选"}
                </button>
              </div>
              {nodeList()}
            </section>
          )}
          {page === "subscriptions" && (
            <section className="content-card">
              <div className="section-heading">
                <div>
                  <h3>
                    订阅源{" "}
                    <span className="count-badge">
                      {state.subscriptions.length}
                    </span>
                  </h3>
                  <p>
                    更新采用完整校验；失败时保留现有节点。更新正在使用的订阅会断开连接。
                  </p>
                </div>
              </div>
              {state.subscriptions.map((sub) => (
                <div className="subscription-row" key={sub.id}>
                  <div className="subscription-avatar">
                    <CloudDownload size={23} />
                  </div>
                  <div className="subscription-details">
                    <h3>{sub.name}</h3>
                    <p>
                      {new URL(sub.url).hostname} ·{" "}
                      {
                        state.nodes.filter((n) => n.subscriptionId === sub.id)
                          .length
                      }{" "}
                      个节点
                    </p>
                    <small>
                      {sub.updatedAt
                        ? `更新于 ${new Date(sub.updatedAt).toLocaleString()}`
                        : "尚未更新"}
                    </small>
                  </div>
                  <button
                    className="subtle-button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        { type: "update-subscription", id: sub.id },
                        "订阅已更新",
                      )
                    }
                  >
                    <RefreshCw size={15} className={busy ? "spin" : ""} />
                    更新
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`编辑订阅 ${sub.name}`}
                    onClick={() =>
                      setModal({ type: "subscription", subscription: sub })
                    }
                    disabled={busy}
                  >
                    <SlidersHorizontal size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`删除订阅 ${sub.name}`}
                    onClick={() =>
                      setModal({
                        type: "delete-subscription",
                        subscription: sub,
                      })
                    }
                    disabled={busy}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {!state.subscriptions.length && (
                <div className="empty-state">
                  <div className="empty-icon">
                    <CloudDownload size={31} />
                  </div>
                  <h3>一个订阅，多种可能。</h3>
                  <p>添加 HTTPS 订阅地址，在这里管理你的节点来源。</p>
                  <button
                    className="primary-button"
                    onClick={() => setModal({ type: "subscription" })}
                  >
                    <Plus size={16} />
                    添加订阅
                  </button>
                </div>
              )}
            </section>
          )}
          {page === "logs" && (
            <section className="content-card logs-card">
              <div className="section-heading">
                <div>
                  <h3>实时日志</h3>
                  <p>显示最近 300 条记录；已隐藏已知节点凭据。</p>
                </div>
                <button
                  className="subtle-button"
                  onClick={() => void run({ type: "clear-logs" })}
                  disabled={busy}
                >
                  <Trash2 size={15} />
                  清空
                </button>
              </div>
              <div className="log-output" role="log" aria-label="连接日志">
                {state.logs.length ? (
                  state.logs.map((log) => (
                    <div className={`log-line ${log.level}`} key={log.id}>
                      <time>{new Date(log.time).toLocaleTimeString()}</time>
                      <span>{log.level === "error" ? "ERROR" : "INFO"}</span>
                      <p>{log.message}</p>
                    </div>
                  ))
                ) : (
                  <div className="log-empty">
                    <Terminal size={25} />
                    <p>连接日志会在这里出现。</p>
                  </div>
                )}
              </div>
            </section>
          )}
          {page === "settings" && (
            <SettingsPanel
              settings={state.settings}
              busy={busy}
              save={(settings) =>
                run({ type: "settings", settings }, "设置已保存")
              }
            />
          )}
        </div>
      </main>
      {toast && (
        <div
          className={`toast glass ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <Circle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <ModalDialog
          modal={modal}
          busy={busy}
          close={() => setModal(null)}
          submit={async (action) => {
            if (await run(action)) setModal(null);
          }}
        />
      )}
    </div>
  );
}
function SettingsPanel({
  settings,
  busy,
  save,
}: {
  settings: Settings;
  busy: boolean;
  save: (settings: Settings) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft({ ...draft, [key]: value });
  return (
    <form
      className="settings-stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save(draft);
      }}
    >
      <section className="content-card settings-card">
        <div className="section-heading">
          <div>
            <h3>
              <Sparkles size={18} />
              外观与体验
            </h3>
            <p>轻盈、清晰，也照顾每一种使用习惯。</p>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <strong>主题</strong>
            <p>让工作空间与你的系统保持协调。</p>
          </div>
          <div className="segmented">
            {(["system", "light", "dark"] as const).map((theme, index) => (
              <button
                type="button"
                key={theme}
                className={draft.theme === theme ? "active" : ""}
                onClick={() => update("theme", theme)}
                aria-pressed={draft.theme === theme}
              >
                {index === 1 ? (
                  <Sun size={15} />
                ) : index === 2 ? (
                  <Moon size={15} />
                ) : (
                  <Layers3 size={15} />
                )}{" "}
                {["跟随系统", "浅色", "深色"][index]}
              </button>
            ))}
          </div>
        </div>
        <Toggle
          label="减少透明效果"
          description="使用实色表面，提升文字对比度；关闭 Windows 材质效果。"
          value={draft.reduceTransparency}
          onChange={(v) => update("reduceTransparency", v)}
        />
        <Toggle
          label="减少动态效果"
          description="关闭装饰性过渡与动画；同时尊重系统的减少动画偏好。"
          value={draft.reduceMotion}
          onChange={(v) => update("reduceMotion", v)}
        />
      </section>
      <section className="content-card settings-card">
        <div className="section-heading">
          <div>
            <h3>
              <Code2 size={18} />
              代理内核
            </h3>
            <p>你的 fork 是默认内核；现代 Reality / Vision 节点请使用 Xray。</p>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <strong>使用的内核</strong>
            <p>切换内核将断开当前连接。</p>
          </div>
          <select
            aria-label="代理内核"
            value={draft.kernel}
            onChange={(e) =>
              update("kernel", e.target.value as Settings["kernel"])
            }
          >
            <option value="fork">v2Modern · 仓库内核</option>
            <option value="xray">Xray · 外部内核</option>
          </select>
        </div>
        {draft.kernel === "xray" && (
          <div className="setting-row path-setting">
            <div>
              <strong>Xray 可执行文件</strong>
              <p>请选择可信来源的 xray.exe，客户端不会自动下载内核。</p>
            </div>
            <div className="path-input">
              <input
                aria-label="Xray 可执行文件路径"
                value={draft.xrayPath}
                onChange={(e) => update("xrayPath", e.target.value)}
                placeholder="选择 xray.exe…"
              />
              <button
                className="subtle-button"
                type="button"
                onClick={() =>
                  void window.desktop.chooseXray().then((path) => {
                    if (path) update("xrayPath", path);
                  })
                }
              >
                浏览
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="content-card settings-card">
        <div className="section-heading">
          <div>
            <h3>
              <ShieldCheck size={18} />
              连接设置
            </h3>
            <p>监听地址固定为 127.0.0.1；修改连接设置会断开当前连接。</p>
          </div>
        </div>
        <Toggle
          label="连接时设置 Windows 系统代理"
          description="断开或退出时恢复原设置；关闭窗口会保留连接并隐藏到托盘。"
          value={draft.systemProxy}
          onChange={(v) => update("systemProxy", v)}
        />
        <div className="setting-row">
          <div>
            <strong>本地监听端口</strong>
            <p>HTTP 与 SOCKS5 必须使用不同端口。</p>
          </div>
          <div className="port-inputs">
            <label>
              HTTP
              <input
                type="number"
                min="1"
                max="65535"
                required
                value={draft.httpPort}
                onChange={(e) => update("httpPort", Number(e.target.value))}
              />
            </label>
            <label>
              SOCKS5
              <input
                type="number"
                min="1"
                max="65535"
                required
                value={draft.socksPort}
                onChange={(e) => update("socksPort", Number(e.target.value))}
              />
            </label>
          </div>
        </div>
      </section>
      <div className="settings-actions">
        <span className="muted">更改将在保存后生效。</span>
        <button className="primary-button" disabled={busy} type="submit">
          <Check size={16} />
          保存设置
        </button>
      </div>
    </form>
  );
}
function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <button
        type="button"
        className={`toggle ${value ? "on" : ""}`}
        role="switch"
        aria-label={label}
        aria-checked={value}
        onClick={() => onChange(!value)}
      >
        <span />
      </button>
    </div>
  );
}
function ModalDialog({
  modal,
  busy,
  close,
  submit,
}: {
  modal: Modal;
  busy: boolean;
  close: () => void;
  submit: (action: Action) => Promise<void>;
}) {
  const [text, setText] = useState(""),
    [node, setNode] = useState<ProxyNode>(
      modal.type === "node" && modal.node
        ? modal.node
        : nodeSchema.parse({
            id: uuid(),
            name: "新节点",
            protocol: "socks",
            address: "127.0.0.1",
            port: 1080,
          }),
    ),
    [sub, setSub] = useState<Subscription>(
      modal.type === "subscription" && modal.subscription
        ? modal.subscription
        : { id: uuid(), name: "", url: "" },
    );
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const container = dialogRef.current;
    const focusables = () =>
      Array.from(
        container?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,textarea,select,[tabindex="0"]',
        ) || [],
      );
    focusables()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
      if (e.key === "Tab") {
        const elements = focusables();
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [busy]);
  const edit = <K extends keyof ProxyNode>(key: K, value: ProxyNode[K]) =>
    setNode({ ...node, [key]: value });
  const isDelete =
    modal.type === "delete-node" || modal.type === "delete-subscription";
  const title =
    modal.type === "import"
      ? "导入节点"
      : modal.type === "node"
        ? modal.node
          ? "编辑节点"
          : "添加节点"
        : modal.type === "subscription"
          ? modal.subscription
            ? "编辑订阅"
            : "添加订阅"
          : modal.type === "delete-node"
            ? "删除节点？"
            : "删除订阅？";
  const field = (
    label: string,
    key: keyof ProxyNode,
    type = "text",
    required = false,
  ) => (
    <label>
      {label}
      <input
        type={type}
        required={required}
        autoComplete="off"
        value={String(node[key] ?? "")}
        onChange={(e) =>
          edit(
            key,
            (type === "number"
              ? Number(e.target.value)
              : e.target.value) as never,
          )
        }
      />
    </label>
  );
  async function onSubmit() {
    if (modal.type === "import") await submit({ type: "import", text });
    if (modal.type === "node") await submit({ type: "save-node", node });
    if (modal.type === "subscription")
      await submit({ type: "save-subscription", subscription: sub });
    if (modal.type === "delete-node")
      await submit({ type: "delete-node", id: modal.node.id });
    if (modal.type === "delete-subscription")
      await submit({ type: "delete-subscription", id: modal.subscription.id });
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <div
        className={`modal glass ${modal.type === "node" ? "wide" : ""}`}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
        >
          <div className="modal-heading">
            <div>
              <div className="eyebrow">V2 MODERN</div>
              <h2 id="dialog-title">{title}</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭对话框"
              onClick={close}
              disabled={busy}
            >
              <X size={20} />
            </button>
          </div>
          <div className="modal-body">
            {modal.type === "import" && (
              <>
                <p className="muted">
                  粘贴节点链接，每行一个。支持
                  VMess、VLESS、Trojan、Shadowsocks，以及 Base64 编码订阅内容。
                </p>
                <textarea
                  aria-label="节点链接"
                  placeholder={"vmess://…\nvless://…\ntrojan://…"}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={8}
                  required
                  maxLength={2 * 1024 * 1024}
                />
                <small className="muted">
                  包含不支持的参数时会停止导入，避免产生无法连接的节点。
                </small>
              </>
            )}
            {modal.type === "subscription" && (
              <div className="form-stack">
                <label>
                  订阅名称
                  <input
                    value={sub.name}
                    onChange={(e) => setSub({ ...sub, name: e.target.value })}
                    placeholder="例如：我的订阅"
                    required
                    maxLength={120}
                  />
                </label>
                <label>
                  HTTPS 订阅地址
                  <input
                    type="url"
                    value={sub.url}
                    onChange={(e) => setSub({ ...sub, url: e.target.value })}
                    placeholder="https://example.com/subscription"
                    required
                    maxLength={2048}
                  />
                </label>
                <p className="muted">
                  保存后点击“更新”获取节点。订阅地址可能包含凭据，不会显示在列表或日志中。
                </p>
              </div>
            )}
            {modal.type === "node" && (
              <div className="form-grid">
                {field("节点名称", "name", "text", true)}
                <label>
                  协议
                  <select
                    value={node.protocol}
                    onChange={(e) => {
                      const protocol = e.target.value as ProxyNode["protocol"];
                      setNode({
                        ...node,
                        protocol,
                        security: protocol === "trojan" ? "tls" : "none",
                        transport: "tcp",
                        flow: "",
                        cipher: protocol === "ss" ? "aes-128-gcm" : "auto",
                      });
                    }}
                  >
                    {["vmess", "vless", "trojan", "ss", "socks", "http"].map(
                      (p) => (
                        <option key={p} value={p}>
                          {p === "ss" ? "Shadowsocks" : p.toUpperCase()}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                {field("服务器地址", "address", "text", true)}
                {field("端口", "port", "number", true)}
                {["vmess", "vless"].includes(node.protocol) &&
                  field("UUID", "uuid", "text", true)}
                {["ss", "trojan", "socks", "http"].includes(node.protocol) &&
                  field(
                    "密码",
                    "password",
                    "password",
                    ["ss", "trojan"].includes(node.protocol),
                  )}
                {["socks", "http"].includes(node.protocol) &&
                  field("用户名（可选）", "username")}
                {node.protocol === "vmess" &&
                  field("Alter ID", "alterId", "number")}
                {["ss", "vmess"].includes(node.protocol) && (
                  <label>
                    加密方式
                    <select
                      value={node.cipher}
                      onChange={(e) => edit("cipher", e.target.value)}
                    >
                      {(node.protocol === "ss"
                        ? [
                            "aes-128-gcm",
                            "aes-256-gcm",
                            "chacha20-ietf-poly1305",
                          ]
                        : ["auto", "aes-128-gcm", "chacha20-poly1305", "none"]
                      ).map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                )}
                {["vmess", "vless", "trojan"].includes(node.protocol) && (
                  <>
                    <label>
                      传输
                      <select
                        value={node.transport}
                        onChange={(e) =>
                          edit(
                            "transport",
                            e.target.value as ProxyNode["transport"],
                          )
                        }
                      >
                        <option value="tcp">TCP</option>
                        <option value="ws">WebSocket</option>
                        <option value="grpc">gRPC · Xray</option>
                      </select>
                    </label>
                    <label>
                      传输安全
                      <select
                        value={node.security}
                        onChange={(e) =>
                          edit(
                            "security",
                            e.target.value as ProxyNode["security"],
                          )
                        }
                      >
                        <option value="none">无</option>
                        <option value="tls">TLS</option>
                        {node.protocol === "vless" && (
                          <option value="reality">Reality · Xray</option>
                        )}
                      </select>
                    </label>
                    {node.security !== "none" &&
                      field("SNI / Server Name", "sni")}
                    {node.transport === "ws" && (
                      <>
                        {field("WebSocket 路径", "path")}
                        {field("WebSocket Host", "host")}
                      </>
                    )}
                    {node.transport === "grpc" &&
                      field("gRPC Service Name", "serviceName")}
                    {node.protocol === "vless" && (
                      <label>
                        Flow
                        <select
                          value={node.flow}
                          onChange={(e) => edit("flow", e.target.value)}
                        >
                          <option value="">无</option>
                          <option value="xtls-rprx-vision">
                            xtls-rprx-vision · Xray
                          </option>
                        </select>
                      </label>
                    )}
                    {node.security === "reality" && (
                      <>
                        {field("Reality 公钥", "publicKey", "text", true)}
                        {field("Short ID", "shortId")}
                        {field("Fingerprint", "fingerprint", "text", true)}
                      </>
                    )}
                  </>
                )}
                <p className="form-note">
                  编辑正在连接的节点会断开连接。TLS 证书验证始终开启。
                </p>
              </div>
            )}
            {isDelete && (
              <p>
                {modal.type === "delete-node"
                  ? `删除「${modal.node.name}」后无法撤销；如果正在使用，将先断开连接。`
                  : `删除「${modal.subscription.name}」及其全部节点；如果正在使用，将先断开连接。`}
              </p>
            )}
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="subtle-button"
              disabled={busy}
              onClick={close}
            >
              取消
            </button>
            <button
              type="submit"
              className={isDelete ? "danger-button" : "primary-button"}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : isDelete ? (
                <Trash2 size={16} />
              ) : (
                <Check size={16} />
              )}{" "}
              {isDelete
                ? "确认删除"
                : modal.type === "import"
                  ? "导入节点"
                  : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
