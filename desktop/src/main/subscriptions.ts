import { parseProfiles } from "./profiles";
import { Subscription } from "../shared/model";
export type SubscriptionFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;
export async function downloadSubscription(
  subscription: Subscription,
  fetcher: SubscriptionFetcher = fetch,
) {
  const url = new URL(subscription.url);
  if (url.protocol !== "https:") throw new Error("订阅必须使用 HTTPS");
  let response: Response;
  try {
    response = await fetcher(url.href, {
      signal: AbortSignal.timeout(20000),
      redirect: "error",
      headers: { "User-Agent": "V2Modern/0.1", Accept: "text/plain" },
    });
  } catch {
    throw new Error("订阅下载失败：检查网络、HTTPS 证书或重定向；原节点已保留");
  }
  if (!response.ok)
    throw new Error(`订阅服务器返回 HTTP ${response.status}，原节点已保留`);
  if (Number(response.headers.get("content-length")) > 2 * 1024 * 1024)
    throw new Error("订阅超过 2 MB");
  if (!response.body) throw new Error("订阅响应为空");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error("订阅超过 2 MB");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return parseProfiles(Buffer.concat(chunks).toString("utf8")).map((n) => ({
    ...n,
    subscriptionId: subscription.id,
  }));
}
