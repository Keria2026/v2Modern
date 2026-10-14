import { EventEmitter } from "node:events";
import { z } from "zod";
import {
  Action,
  LogEntry,
  nodeSchema,
  SavedState,
  settingsSchema,
  Snapshot,
  subscriptionSchema,
} from "../shared/model";
import { CoreManager, redact } from "./core-manager";
import { StateStore } from "./store";
import { parseProfiles } from "./profiles";
import { downloadSubscription, SubscriptionFetcher } from "./subscriptions";
const id = z.string().min(1).max(100);
const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("import"),
    text: z.string().max(2 * 1024 * 1024),
  }),
  z.object({ type: z.literal("save-node"), node: nodeSchema }),
  z.object({ type: z.literal("delete-node"), id }),
  z.object({ type: z.literal("select"), id }),
  z.object({
    type: z.literal("save-subscription"),
    subscription: subscriptionSchema,
  }),
  z.object({ type: z.literal("delete-subscription"), id }),
  z.object({ type: z.literal("update-subscription"), id }),
  z.object({ type: z.literal("settings"), settings: settingsSchema }),
  z.object({ type: z.literal("connect"), id }),
  z.object({ type: z.literal("disconnect") }),
  z.object({ type: z.literal("clear-logs") }),
]);
export class AppService extends EventEmitter {
  private logs: LogEntry[] = [];
  private logId = 0;
  constructor(
    public state: SavedState,
    private store: StateStore,
    public core: CoreManager,
    private version: string,
    private fetcher: SubscriptionFetcher = fetch,
    private appearance = () => ({
      materialAvailable: false,
      systemReduceTransparency: false,
    }),
  ) {
    super();
    core.on("change", () => this.emit("change"));
    core.on("log", (text: string) => this.log(text));
  }
  log(message: string, level: "info" | "error" = "info") {
    for (const node of this.state.nodes) message = redact(message, node);
    this.logs.push({
      id: ++this.logId,
      time: new Date().toISOString(),
      level,
      message,
    });
    this.logs = this.logs.slice(-300);
    this.emit("change");
  }
  async snapshot(): Promise<Snapshot> {
    return {
      ...this.state,
      connection: this.core.connection,
      logs: this.logs,
      kernelAvailable: await this.core.available(this.state.settings),
      platform: process.platform,
      version: this.version,
      storageSecure: this.store.secure,
      ...this.appearance(),
    };
  }
  private async save(next: SavedState) {
    if (next.nodes.length > 5000 || next.subscriptions.length > 100)
      throw new Error("节点或订阅数量超过上限");
    await this.store.save(next);
    this.state = next;
    this.emit("change");
  }
  async action(raw: unknown): Promise<Snapshot> {
    const parsed = actionSchema.safeParse(raw);
    if (!parsed.success)
      throw new Error(parsed.error.issues.map((i) => i.message).join("；"));
    const action = parsed.data;
    switch (action.type) {
      case "import": {
        const nodes = parseProfiles(action.text);
        await this.save({
          ...this.state,
          nodes: [...this.state.nodes, ...nodes],
          selectedId: this.state.selectedId || nodes[0]?.id || null,
        });
        this.log(`已导入 ${nodes.length} 个节点`);
        break;
      }
      case "save-node": {
        if (this.core.connection.nodeId === action.node.id)
          await this.core.disconnect();
        const nodes = this.state.nodes.filter((n) => n.id !== action.node.id);
        nodes.push(action.node);
        await this.save({
          ...this.state,
          nodes,
          selectedId: this.state.selectedId || action.node.id,
        });
        break;
      }
      case "delete-node": {
        if (this.core.connection.nodeId === action.id)
          await this.core.disconnect();
        const nodes = this.state.nodes.filter((n) => n.id !== action.id);
        await this.save({
          ...this.state,
          nodes,
          selectedId:
            this.state.selectedId === action.id
              ? nodes[0]?.id || null
              : this.state.selectedId,
        });
        break;
      }
      case "select":
        if (!this.state.nodes.some((n) => n.id === action.id))
          throw new Error("节点不存在");
        await this.save({ ...this.state, selectedId: action.id });
        break;
      case "save-subscription":
        await this.save({
          ...this.state,
          subscriptions: [
            ...this.state.subscriptions.filter(
              (s) => s.id !== action.subscription.id,
            ),
            action.subscription,
          ],
        });
        break;
      case "delete-subscription": {
        if (
          this.state.nodes.some(
            (n) =>
              n.subscriptionId === action.id &&
              n.id === this.core.connection.nodeId,
          )
        )
          await this.core.disconnect();
        const nodes = this.state.nodes.filter(
          (n) => n.subscriptionId !== action.id,
        );
        await this.save({
          ...this.state,
          nodes,
          subscriptions: this.state.subscriptions.filter(
            (s) => s.id !== action.id,
          ),
          selectedId: nodes.some((n) => n.id === this.state.selectedId)
            ? this.state.selectedId
            : nodes[0]?.id || null,
        });
        break;
      }
      case "update-subscription": {
        const sub = this.state.subscriptions.find((s) => s.id === action.id);
        if (!sub) throw new Error("订阅不存在");
        const incoming = await downloadSubscription(sub, this.fetcher);
        if (
          this.state.nodes.some(
            (n) =>
              n.subscriptionId === sub.id &&
              n.id === this.core.connection.nodeId,
          )
        )
          await this.core.disconnect();
        const nodes = [
          ...this.state.nodes.filter((n) => n.subscriptionId !== sub.id),
          ...incoming,
        ];
        await this.save({
          ...this.state,
          nodes,
          subscriptions: this.state.subscriptions.map((s) =>
            s.id === sub.id ? { ...s, updatedAt: new Date().toISOString() } : s,
          ),
          selectedId: nodes.some((n) => n.id === this.state.selectedId)
            ? this.state.selectedId
            : nodes[0]?.id || null,
        });
        this.log(`订阅已更新：${incoming.length} 个节点`);
        break;
      }
      case "settings": {
        const old = this.state.settings,
          next = action.settings;
        if (
          ["kernel", "xrayPath", "httpPort", "socksPort", "systemProxy"].some(
            (k) => old[k as keyof typeof old] !== next[k as keyof typeof next],
          )
        )
          await this.core.disconnect();
        await this.save({ ...this.state, settings: next });
        break;
      }
      case "connect": {
        const n = this.state.nodes.find((n) => n.id === action.id);
        if (!n) throw new Error("请选择节点");
        await this.save({ ...this.state, selectedId: n.id });
        await this.core.connect(n, this.state.settings);
        break;
      }
      case "disconnect":
        await this.core.disconnect();
        this.log("已断开连接，系统代理已恢复");
        break;
      case "clear-logs":
        this.logs = [];
        this.emit("change");
        break;
    }
    return this.snapshot();
  }
}
