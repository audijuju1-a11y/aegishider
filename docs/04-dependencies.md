# Aegishider 3.1.0 — Dependency, License and Compatibility Report

Build target: **Paper 1.21.4** (`paper-api 1.21.4-R0.1-SNAPSHOT`), **Java 21**,
**Maven**.

## Compile / runtime dependencies

| Artifact | Version | Scope | License | Redistributed in the plugin JAR? | Purpose |
|---|---|---|---|---|---|
| `io.papermc.paper:paper-api` | 1.21.4-R0.1-SNAPSHOT | provided | GPL-3.0 (Paper API; Bukkit API is GPL-3.0 with some MIT-derived files) | **no** (server-provided) | Bukkit/Paper API |
| `com.github.retrooper:packetevents-api` | 2.14.0 | provided | **GPL-3.0** | **no** | outgoing packet interception (chunk/block/entity filtering) |
| `it.unimi.dsi:fastutil-core` | 8.5.13 | compile | Apache License 2.0 | **yes**, shaded and relocated to `dev.audismp.aegishider.libs.fastutil` | primitive collections |
| `org.junit.jupiter:junit-jupiter` | 5.11.4 | test | Eclipse Public License 2.0 | no | unit tests |

### Runtime plugin requirement: PacketEvents

`plugin.yml` declares `softdepend: [packetevents]`. To get **block/container/chunk
protection**, the server must install the PacketEvents plugin (version **2.14.0 or newer**;
the gateway refuses to activate on older versions). PacketEvents is not shaded and Aegishider
does not copy or redistribute its code; Aegishider only calls its public API at runtime.
The GPL-3.0 implications of linking to a GPL-3.0 runtime library should be reviewed by the
server owner before redistribution of a modified Aegishider build; the delivered build keeps
PacketEvents external precisely to avoid embedding GPL code in the plugin. (This is a
licensing report, not legal advice.)

Without PacketEvents the plugin still loads and protects dropped items/entities with
Paper's native visibility API, but block protection is disabled and reported as
`INACTIVE` - it does not fall back to an insecure post-send patching mode.

FastUtil is shaded and relocated because it is used in hot paths. The shade plugin includes
FastUtil's `META-INF/LICENSE` in the resulting jar; the Apache-2.0 notice is preserved.
No other third-party code is copied into this project. No code was taken from AGPL
projects. PacketEvents' source was consulted only to verify public API semantics (event
buffer layout, wrapper field order); no PacketEvents source is included.

## Plugin JAR contents (verified with `jar tf` / manifest inspection)

- `dev/audismp/aegishider/**` (all plugin classes)
- `dev/audismp/aegishider/libs/fastutil/**` (relocated)
- `plugin.yml`, `config.yml`
- `META-INF/LICENSE` (FastUtil Apache-2.0)
- No `packetevents`, `paper` or other server classes are bundled.

## Compatibility matrix

| Environment | Status |
|---|---|
| Paper 1.21.4 (build 232) | **target**, integration-tested |
| Java 21 | **required/used** (records, pattern matching, `List.of`, `getPluginMeta` avoidance) |
| Other Paper 1.21.x builds | not supported by this build: the packet gateway deliberately requires `ServerVersion == V_1_21_4` because chunk-packet layout and (from 1.21.5) heightmap serialization differ. Without gateway support, block protection is reported INACTIVE (fail-closed) while entity protection remains native. |
| Folia | **not supported** (`folia-supported: false`); global scheduler + region-local assumptions are Paper-only |
| Clients | Java 1.18+ clients (chunk reserialization path is 1.18+). Clients older than 1.18 receive no sensitive chunk packets (fail-closed) instead of unsanitized data. |
| Protocol translation plugins (ViaVersion) | not tested; with translated clients older than 1.18 the gateway cancels sensitive chunk packets, and block/entity state may be degraded. Documented as a limitation. |
| `UltimateTeams` / team plugins | not used; player-vs-player hiding is not implemented, so no team integration is required. |

## Removed dependencies

The legacy build had no PacketEvents/ProtocolLib. No dependency was removed; FastUtil and
Paper API remain. The new `packetevents-api` dependency is `provided` (compile only), so the
runtime plugin remains the single source of PacketEvents.

## Reproducible build

```
mvn -B clean verify
```

produces `target/Aegishider-3.1.0.jar` (shaded, relocated FastUtil) and runs the unit test
suite. The integration test harness lives outside the Maven module in `D:\Aegishider\itest`
(not shipped) because it requires a real Paper server and headless clients.
