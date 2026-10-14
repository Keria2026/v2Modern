import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  defaults,
  nodeSchema,
  SavedState,
  settingsSchema,
  subscriptionSchema,
} from "../shared/model";
export interface Codec {
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
const stateSchema = z.object({
  nodes: z.array(nodeSchema).max(5000),
  subscriptions: z.array(subscriptionSchema).max(100),
  settings: settingsSchema,
  selectedId: z.string().nullable(),
});
export class StateStore {
  constructor(
    private directory: string,
    private codec: Codec | null,
  ) {}
  get secure() {
    return !!this.codec;
  }
  async load(): Promise<SavedState> {
    let data: Buffer;
    try {
      data = await readFile(join(this.directory, "profiles.enc"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return defaults();
      throw e;
    }
    if (!this.codec)
      throw new Error(
        "无法解密已有配置；请恢复系统凭据存储后重试，原文件已保留",
      );
    return stateSchema.parse(JSON.parse(this.codec.decrypt(data)));
  }
  async save(state: SavedState) {
    // Without OS encryption, keep credentials in memory only.
    if (!this.codec) return;
    const data = this.codec.encrypt(JSON.stringify(stateSchema.parse(state)));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = join(this.directory, "profiles.enc");
    await writeFile(target + ".tmp", data, { mode: 0o600 });
    await rename(target + ".tmp", target);
  }
}
