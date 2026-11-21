#!/usr/bin/env bash
# Publish the locally hardened 4.0.3 jars as a new published release set.
# Uploads six jars to R2 and inserts/updates product_releases rows.
# Requires a logged-in wrangler and dist/obf/SHA256SUMS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
WRANGLER="$ROOT/platform/node_modules/wrangler/bin/wrangler.js"
SUMS="$ROOT/dist/obf/SHA256SUMS"
SQL="$ROOT/.release/update-release-403.sql"
VERSION="4.0.3"
R2_BUCKET="bhcp-archive"

if [ ! -f "$SUMS" ]; then
    echo "missing $SUMS; run scripts/harden-local.sh first" >&2
    exit 1
fi
mkdir -p "$ROOT/.release"
: > "$SQL"

publish() {
    local suffix="$1" release_id="$2" version="$3" r2_key="$4" minecraft="$5" java="$6" note="$7"
    local jar="$ROOT/dist/obf/Aegishider-$VERSION-$suffix.jar"
    if [ ! -f "$jar" ]; then
        echo "missing $jar" >&2
        exit 1
    fi
    local sha size
    sha="$(awk -v f="Aegishider-$VERSION-$suffix.jar" '$2=="*"f {print $1}' "$SUMS")"
    size="$(stat -c %s "$jar")"
    if [ -z "$sha" ]; then
        echo "no SHA for $suffix in $SUMS" >&2
        exit 1
    fi
    echo "== upload $suffix ($sha) =="
    node "$WRANGLER" r2 object put "$R2_BUCKET/$r2_key" \
        --file "$(cygpath -m "$jar" 2>/dev/null || echo "$jar")" \
        --content-type application/java-archive --remote | tail -1

    local now_sql
    now_sql="(CAST(strftime('%s','now') AS INTEGER)*1000)"
    cat >> "$SQL" <<SQL
INSERT INTO product_releases
  (id, product_id, version, channel, status, notes, supported_minecraft, supported_java,
   supported_platforms, artifact_url, artifact_sha256, artifact_r2_key, artifact_size_bytes,
   signing_key_id, artifact_signature, released_at, created_at)
VALUES
  ('$release_id', 'prod_basehider', '$version', 'stable', 'published', '$note',
   '$minecraft', '$java', '["Paper"]', '/release/$release_id/download', '$sha', '$r2_key', $size,
   NULL, NULL, $now_sql, $now_sql)
ON CONFLICT(id) DO UPDATE SET
  version=excluded.version, status='published', notes=excluded.notes,
  supported_minecraft=excluded.supported_minecraft, supported_java=excluded.supported_java,
  supported_platforms=excluded.supported_platforms, artifact_url=excluded.artifact_url,
  artifact_sha256=excluded.artifact_sha256, artifact_r2_key=excluded.artifact_r2_key,
  artifact_size_bytes=excluded.artifact_size_bytes, released_at=excluded.released_at;
SQL
}

publish mc1.21.11 rel_ag_403_mc12111 "4.0.3" \
    "releases/prod_basehider/4.0.3/Aegishider-4.0.3-mc1.21.11.jar" \
    '["1.21.9","1.21.10","1.21.11"]' '["21"]' \
    "Aegishider 4.0.3 (Paper 1.21.9-1.21.11, recommended). Player-fair height-shield dead band, FOV 360 default, beacon/bookshelf opt-in, entity ray reserve, stricter two-layer licence gate, cached-lease grace, TunnelShield packet-thread fix, viewer command null-safe, ProGuard + string encryption, deep server-health heartbeat and admin dashboard. Offline hardened build (SHA-256 only)."
publish mc26.3 rel_ag_403_mc263 "4.0.3+mc26.3" \
    "releases/prod_basehider/4.0.3+mc26.3/Aegishider-4.0.3-mc26.3.jar" \
    '["26.2","26.3"]' '["25"]' \
    "Aegishider 4.0.3 for Paper 26.2-26.3 (Java 25). Same hardening and player-fair defaults. Offline ProGuard build (SHA-256 only)."
publish mc26.1 rel_ag_403_mc261 "4.0.3+mc26.1" \
    "releases/prod_basehider/4.0.3+mc26.1/Aegishider-4.0.3-mc26.1.jar" \
    '["26.1"]' '["25"]' \
    "Aegishider 4.0.3 for Paper 26.1.x (Java 25). Offline ProGuard build (SHA-256 only)."
publish mc1.21.5 rel_ag_403_mc1215 "4.0.3+mc1.21.5" \
    "releases/prod_basehider/4.0.3+mc1.21.5/Aegishider-4.0.3-mc1.21.5.jar" \
    '["1.21.5","1.21.6","1.21.7","1.21.8"]' '["21"]' \
    "Aegishider 4.0.3 for Paper 1.21.5-1.21.8. Offline ProGuard build (SHA-256 only)."
publish mc1.21.4 rel_ag_403_mc1214 "4.0.3+mc1.21.4" \
    "releases/prod_basehider/4.0.3+mc1.21.4/Aegishider-4.0.3-mc1.21.4.jar" \
    '["1.21.4"]' '["21"]' \
    "Aegishider 4.0.3 for Paper 1.21.4 (full harness build). Offline ProGuard build (SHA-256 only)."
publish mc1.21.1 rel_ag_403_mc1211 "4.0.3+mc1.21.1" \
    "releases/prod_basehider/4.0.3+mc1.21.1/Aegishider-4.0.3-mc1.21.1.jar" \
    '["1.21.1","1.21.2","1.21.3"]' '["21"]' \
    "Aegishider 4.0.3 for Paper 1.21.1-1.21.4. Offline ProGuard build (SHA-256 only)."

echo "== apply D1 release insert/update =="
node "$WRANGLER" d1 execute bhcp-db --remote --file="$(cygpath -m "$SQL" 2>/dev/null || echo "$SQL")" -y | tail -6
echo "published 4.0.3; SQL: $SQL"
