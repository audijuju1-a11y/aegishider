package dev.audismp.aegishider.platform;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Manual live smoke tool (not part of the production plugin):
 *
 *   java -cp target/classes;target/test-classes dev.audismp.aegishider.platform.PlatformLiveSmoke \
 *        http://127.0.0.1:8787 platform-smoke register
 *
 * Phase 1 registers and prints the activation code; claim it in the portal; phase 2
 * requests and verifies a real signed lease, then sends one heartbeat.
 */
public final class PlatformLiveSmoke {

    public static void main(String[] args) throws Exception {
        if (args.length < 3) {
            System.err.println("usage: <baseUrl> <identityDir> <register|lease>");
            System.exit(2);
        }
        String baseUrl = args[0];
        Path directory = Path.of(args[1]);
        String mode = args[2];
        InstallationIdentity identity = InstallationIdentity.loadOrCreate(directory);
        PlatformClient client = new PlatformClient(baseUrl, "aegishider", 15, identity);

        if (mode.equals("register")) {
            PlatformClient.Registration registration = client.register(
                    "3.2.0", "1.21.4", "Paper", "LiveSmoke", "21.0.13");
            Map<String, Object> output = new LinkedHashMap<>();
            output.put("installation_uuid", identity.installationUuid());
            output.put("activation_code", registration.activationCode());
            output.put("installation_id", registration.installationId());
            output.put("portal_url", registration.portalUrl());
            System.out.println(Json.stringify(output));
            return;
        }

        PlatformClient.LeaseResponse response = client.requestLease("3.2.0");
        LeaseVerifier.Lease lease = LeaseVerifier.verify(
                response.lease(), response.keys(), identity.installationUuid(), "aegishider",
                CanonicalRequest.nowSeconds(), 300);

        Map<String, Object> metrics = new LinkedHashMap<>();
        metrics.put("tps", 19.9);
        metrics.put("players_online", 3);
        metrics.put("errors", 0);
        Map<String, Object> heartbeat = new LinkedHashMap<>();
        heartbeat.put("schema_version", 1);
        heartbeat.put("plugin_version", "3.2.0");
        heartbeat.put("minecraft_version", "1.21.4");
        heartbeat.put("platform", "Paper");
        heartbeat.put("java_version", "21.0.13");
        heartbeat.put("enabled_modules", List.of("block-protection"));
        heartbeat.put("metrics", metrics);
        heartbeat.put("occurred_at", CanonicalRequest.nowSeconds());
        client.heartbeat(heartbeat);

        Map<String, Object> output = new LinkedHashMap<>();
        output.put("ok", true);
        output.put("installation_uuid", identity.installationUuid());
        output.put("license_id", lease.claims().get("license_id"));
        output.put("key_id", lease.keyId());
        output.put("expires_at", lease.expiresAt());
        output.put("signature_verified", true);
        output.put("heartbeat", "accepted");
        System.out.println(Json.stringify(output));
    }
}
