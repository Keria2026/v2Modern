import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(desktop, "resources/core");
mkdirSync(output, { recursive: true });
const go = process.env.V2MODERN_GO || "go";
for (const [name, target, tags] of [
  ["v2ray", "./main", []],
  ["v2ctl", "./infra/control/main", ["-tags", "confonly"]],
  ["jobhost", "./desktop/native/jobhost", []],
]) {
  const result = spawnSync(
    go,
    [
      "build",
      "-mod=readonly",
      "-p",
      "5",
      ...tags,
      "-o",
      resolve(output, name + ".exe"),
      target,
    ],
    {
      cwd: resolve(desktop, ".."),
      env: {
        ...process.env,
        GOOS: "windows",
        GOARCH: "amd64",
        CGO_ENABLED: "0",
      },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const file of ["geoip.dat", "geosite.dat"])
  copyFileSync(
    resolve(desktop, "../release/config", file),
    resolve(output, file),
  );
