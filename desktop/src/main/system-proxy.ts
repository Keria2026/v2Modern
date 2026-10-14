import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
const run = promisify(execFile);
const key =
  "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const fields = ["ProxyEnable", "ProxyServer", "ProxyOverride"] as const;
const valueSchema = z.object({
  exists: z.boolean(),
  value: z.union([z.string(), z.number(), z.null()]),
});
const snapshotSchema = z.object({
  ProxyEnable: valueSchema,
  ProxyServer: valueSchema,
  ProxyOverride: valueSchema,
});
export type RegistryState = z.infer<typeof snapshotSchema>;
const journalSchema = z.object({
  previous: snapshotSchema,
  expected: snapshotSchema,
});
const notify = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class InternetRefresh { [DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l); }'; [InternetRefresh]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0) | Out-Null; [InternetRefresh]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0) | Out-Null;`;
export interface ProxyControl {
  enable(port: number): Promise<void>;
  restore(): Promise<void>;
}
export function recoveryState(
  previous: RegistryState,
  expected: RegistryState,
  current: RegistryState,
): RegistryState | null {
  const owned = (["ProxyEnable", "ProxyServer"] as const).every(
    (n) =>
      current[n].exists === expected[n].exists &&
      current[n].value === expected[n].value,
  );
  if (!owned) return null;
  const overrideUnchanged =
    current.ProxyOverride.exists === expected.ProxyOverride.exists &&
    current.ProxyOverride.value === expected.ProxyOverride.value;
  return {
    ...previous,
    ProxyOverride: overrideUnchanged
      ? previous.ProxyOverride
      : current.ProxyOverride,
  };
}
export class WindowsSystemProxy implements ProxyControl {
  constructor(
    private journalPath: string,
    private warn: (text: string) => void = () => {},
  ) {}
  private async powershell(script: string) {
    try {
      const { stdout } = await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(
            `$ErrorActionPreference='Stop'; ${script}`,
            "utf16le",
          ).toString("base64"),
        ],
        { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
      );
      return stdout.trim();
    } catch {
      throw new Error("无法访问 Windows 系统代理设置，请检查权限和 PowerShell");
    }
  }
  private async read(): Promise<RegistryState> {
    const script = `$k=Get-Item -LiteralPath '${key}'; $r=@{}; foreach($n in @('ProxyEnable','ProxyServer','ProxyOverride')) { $e=$k.GetValueNames() -contains $n; $r[$n]=@{exists=$e;value=$k.GetValue($n,$null)} }; $r | ConvertTo-Json -Compress`;
    return snapshotSchema.parse(JSON.parse(await this.powershell(script)));
  }
  private async write(state: RegistryState) {
    const encoded = Buffer.from(JSON.stringify(state)).toString("base64");
    await this.powershell(
      `$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json; foreach($n in @('ProxyEnable','ProxyServer','ProxyOverride')) { $v=$s.$n; if($v.exists) { $t=if($n -eq 'ProxyEnable') {'DWord'} else {'String'}; New-ItemProperty -LiteralPath '${key}' -Name $n -Value $v.value -PropertyType $t -Force | Out-Null } else { Remove-ItemProperty -LiteralPath '${key}' -Name $n -ErrorAction SilentlyContinue } }; ${notify}`,
    );
  }
  async enable(port: number) {
    if (process.platform !== "win32")
      throw new Error(
        "系统代理只适用于 Windows；当前平台可关闭系统代理后测试本地端口",
      );
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("无效代理端口");
    await this.restore();
    const previous = await this.read();
    const expected: RegistryState = {
      ProxyEnable: { exists: true, value: 1 },
      ProxyServer: {
        exists: true,
        value: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
      },
      ProxyOverride: { exists: true, value: "<local>" },
    };
    await mkdir(dirname(this.journalPath), { recursive: true });
    await writeFile(
      this.journalPath + ".tmp",
      JSON.stringify({ previous, expected }),
      { mode: 0o600 },
    );
    await rename(this.journalPath + ".tmp", this.journalPath);
    try {
      await this.write(expected);
    } catch (e) {
      await this.write(previous);
      await unlink(this.journalPath);
      throw e;
    }
  }
  async restore() {
    let raw: string;
    try {
      raw = await readFile(this.journalPath, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    if (process.platform !== "win32")
      throw new Error("发现 Windows 代理恢复记录，请在 Windows 上恢复");
    const { previous, expected } = journalSchema.parse(JSON.parse(raw));
    const current = await this.read();
    const recovered = recoveryState(previous, expected, current);
    if (recovered) await this.write(recovered);
    else this.warn("系统代理已被其他程序修改，已保留当前设置");
    await unlink(this.journalPath);
  }
}
