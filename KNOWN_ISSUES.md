# Validation notes

The `Desktop client` workflow has passed on both Windows and Linux for application source commit `9282f5089764187d48c401696746601a5aa35958`. Its Windows artifacts contain an unsigned installer, unsigned portable executable, and SHA-256 checksums. This validation includes native proxy restoration, process cleanup on parent termination, encrypted storage across an Electron restart, real fork HTTP/CONNECT requests, and real Electron IPC. Linux also verifies Xray configurations, certificate-verified HTTPS, and renderer interactions.

The updated CodeQL workflow has passed for both Go and JavaScript/TypeScript. Source extraction uses modern Go tooling because the extractor invokes `-buildvcs`; application builds and Core tests retain Go 1.15.15 for compatibility with the existing QUIC dependency.

The inherited full Core suite is not consistently green. Observed failures after restoring the old workflows were:

- `app/router/command.TestServiceSubscribeRoutingStats`: the upstream subscription channel closed unexpectedly in an Ubuntu full-suite run. A local targeted run with `-count 50` passed. The channel shutdown/restart lifecycle requires further concurrency investigation.
- `testing/scenarios.TestTLSOverWebSocket`: a read timeout in an Ubuntu coverage run. A local targeted run passed in approximately four seconds. This does not establish reliability under every workload or network environment.

No assertions were disabled, no tests were filtered from the full Core workflows, and Core application source/tests were left unchanged. These failures remain visible in the Test/Coverage workflows; the desktop workflow performs its own required functional tests. The earlier coverage asset-path failure was an environment override affecting `TestGetAssetLocation`; that override was removed.

The first client does not use the routing statistics subscription API. Real remote node compatibility still depends on the selected kernel and the node's protocol/transport configuration. The first release covers VMess, VLESS, Trojan, AEAD Shadowsocks, HTTP and SOCKS; newer transports unsupported by the profile editor are rejected explicitly.

Windows 10/11 appearance, native Acrylic composition, tray behavior and application proxy compatibility should also be checked on the user's desktop. CI uses a hosted Windows runner and cannot replace visual checks on both target OS versions. Builds are unsigned; signing and TUN are outside this release's scope.
