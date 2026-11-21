# Aegishider

Aegishider is the rebranded, hardened continuation of BaseHider: a Paper-server visibility plugin that hides containers, items, entities, and tunnel traces from ESP/X-ray clients without hiding the world from legitimate players.

It ships as six separate builds so each Paper line gets a matching jar:

| Build | Paper versions | Runtime |
| --- | --- | --- |
| `mc1.21.1` | 1.21.1 – 1.21.4 | Java 21 |
| `mc1.21.4` | 1.21.4 (pinned) | Java 21 |
| `mc1.21.5` | 1.21.5 – 1.21.8 | Java 21 |
| `mc1.21.11` | 1.21.9 – 1.21.11 (recommended) | Java 21 |
| `mc26.1` | 26.1.x | Java 25 |
| `mc26.3` | 26.2 – 26.3 | Java 25 |

## Download

- Platform homepage / storefront: **https://aegishider-platform.audijuju1.workers.dev/**
- Pages mirror of the platform homepage: **https://aegishider.pages.dev/**
- Product page: **https://aegishider-platform.audijuju1.workers.dev/plugins/aegishider**

The 4.0.3 jars are hardened with ProGuard 7.10 and string-constant encryption and are
listed in [`docs/releases/Aegishider-4.0.3-SHA256SUMS`](docs/releases/Aegishider-4.0.3-SHA256SUMS); the platform also stores the
SHA-256 on every published release record. The signed Sentinel pipeline can add Ed25519
per-entry manifests when the release key is available; the current local build is
SHA-256-verified only. Verify the SHA-256 before installing.

## Activation

Protection is fail-closed until the server installation is activated on the platform:

1. Copy the jar that matches your Paper version into `plugins/` and install PacketEvents 2.14.0.
2. Start the server and run `/aegishider license link`.
3. Open <https://aegishider-platform.audijuju1.workers.dev/app/activations> and enter the code.
4. Run `/aegishider license refresh`. Protection switches from `WAITING_FOR_LICENSE` to `ACTIVE`.

`platform.yml` defaults to `enforcement: enforce`, which is what gates protection. Local test harnesses opt out with `enabled: false`.

## Build and test

- Plugin build and module documentation: [`aegishider-integrated/README.md`](aegishider-integrated/README.md)
- Signed release pipeline: [`scripts/release.sh`](scripts/release.sh) (six builds, string encryption, ProGuard, signed manifests, `SHA256SUMS`)
- Local hardened build: [`scripts/harden-local.sh`](scripts/harden-local.sh) (JDK 21/25 + Maven + ProGuard 7.10 + ASM; six obfuscated jars and `SHA256SUMS` without the Sentinel release key)
- Unit tests: `mvn -B test` in `aegishider-integrated` (148 tests, 1 POSIX-only test skipped on Windows)
- Live-server harness and behavior tests: [`itest/`](itest/)
- CI: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)

## Repository layout

| Path | Purpose |
| --- | --- |
| `aegishider-integrated/` | Paper plugin (Java 21/25, PacketEvents gateway) |
| `platform/` | Cloudflare Workers + D1/KV/R2 licensing and telemetry platform |
| `site/` | Cloudflare Pages mirror of the platform homepage (static snapshot + local assets) |
| `scripts/` | Release, publishing, and packaging scripts |
| `docs/` | Architecture, audits, test plans, and evidence |

The BaseHider 3.0.0 references in `docs/` and the test evidence are the historical baseline used to prove the A–F leak scenarios before and after the fixes.
