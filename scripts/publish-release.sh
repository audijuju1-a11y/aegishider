#!/usr/bin/env bash
# Publish dist/obf/*.jar to R2 and update the production D1 release rows.
# Requires a logged-in wrangler (the platform node_modules has wrangler 4.162.0).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
WRANGLER="$ROOT/platform/node_modules/wrangler/bin/wrangler.js"
SUMS="$ROOT/dist/obf/SHA256SUMS"
SQL="$ROOT/.release/update-release-sha.sql"
R2_BUCKET="bhcp-archive"

if [ ! -f "$SUMS" ]; then
    echo "missing $SUMS; run scripts/release.sh first" >&2
    exit 1
fi
mkdir -p "$ROOT/.release"
: > "$SQL"

publish() {
    local suffix="$1" release_id="$2" r2_key="$3" note="$4"
    local jar="$ROOT/dist/obf/Aegishider-4.0.0-$suffix.jar"
    if [ ! -f "$jar" ]; then
        echo "missing $jar" >&2
        exit 1
    fi
    local sha size
    sha="$(awk -v f="Aegishider-4.0.0-$suffix.jar" '$2=="*"f {print $1}' "$SUMS")"
    size="$(stat -c %s "$jar")"
    if [ -z "$sha" ]; then
        echo "no SHA for $suffix" >&2
        exit 1
    fi
    echo "== upload $suffix ($sha) =="
    node "$WRANGLER" r2 object put "$R2_BUCKET/$r2_key" \
        --file "$(cygpath -m "$jar")" --content-type application/java-archive --remote | tail -1
    printf "UPDATE product_releases SET artifact_sha256='%s', artifact_size_bytes=%s, notes='%s' WHERE id='%s';\n" \
        "$sha" "$size" "$note" "$release_id" >> "$SQL"
}

publish mc1.21.11 rel_ag_400_mc12111 "releases/prod_basehider/4.0.0/Aegishider-4.0.0-mc1.21.11.jar" \
    "Aegishider 4.0.0 hardened: licence gate, monster occlusion-only, ghost-block fix, 16-block reveal, string encryption, anti-debug, pinned platform key, server-side jar hash. Paper 1.21.9-1.21.11."
publish mc26.3 rel_ag_400_mc263 "releases/prod_basehider/4.0.0+mc26.3/Aegishider-4.0.0-mc26.3.jar" \
    "Aegishider 4.0.0 hardened for Paper 26.2-26.3 (Java 25 runtime). Licence gate, monster occlusion-only, ghost fix, string encryption, anti-debug, pinned key, server-side jar hash."
publish mc26.1 rel_ag_400_mc261 "releases/prod_basehider/4.0.0+mc26.1/Aegishider-4.0.0-mc26.1.jar" \
    "Aegishider 4.0.0 hardened for Paper 26.1.x. Licence gate, monster occlusion-only, ghost fix, string encryption, anti-debug, pinned key, server-side jar hash."
publish mc1.21.5 rel_ag_400_mc1215 "releases/prod_basehider/4.0.0+mc1.21.5/Aegishider-4.0.0-mc1.21.5.jar" \
    "Aegishider 4.0.0 hardened for Paper 1.21.5-1.21.8. Licence gate, monster occlusion-only, ghost fix, string encryption, anti-debug, pinned key, server-side jar hash."
publish mc1.21.4 rel_ag_400_mc1214 "releases/prod_basehider/4.0.0+mc1.21.4/Aegishider-4.0.0-mc1.21.4.jar" \
    "Aegishider 4.0.0 hardened for Paper 1.21.4 (full A-F harness build). Licence gate, monster occlusion-only, ghost fix, string encryption, anti-debug, pinned key, server-side jar hash."
publish mc1.21.1 rel_ag_400_mc1211 "releases/prod_basehider/4.0.0+mc1.21.1/Aegishider-4.0.0-mc1.21.1.jar" \
    "Aegishider 4.0.0 hardened for Paper 1.21.1-1.21.4. Licence gate, monster occlusion-only, ghost fix, string encryption, anti-debug, pinned key, server-side jar hash."

echo "== apply D1 release update =="
node "$WRANGLER" d1 execute bhcp-db --remote --file="$(cygpath -m "$SQL")" -y | tail -6
echo "published; SQL: $SQL"
