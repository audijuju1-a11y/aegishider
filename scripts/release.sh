#!/usr/bin/env bash
# Reproducible Aegishider release: six Paper targets + Sentinel Shield JAR
# obfuscation + Ed25519-signed entry manifests + SHA256SUMS.
#
# Requirements (not committed):
#   .tools/jdk21/jdk-*/bin/java      JDK 21 (compile 1.21.x + ProGuard backend)
#   .tools/jdk-25*/bin/java          JDK 25 (compile 26.x against paper-api 26.x)
#   .tools/proguard/proguard-*/lib/proguard.jar
#   .release/keys/release.pem        Ed25519 release key (never commit)
#   .release/keys/keyring.json
#   SENTINEL_PY                      python of the sentinel-shield venv
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MVN="$ROOT/.tools/apache-maven-3.9.9/bin/mvn"
JDK21="$(ls -d "$ROOT"/.tools/jdk21/jdk-21* | head -1)"
JDK25="$(ls -d "$ROOT"/.tools/jdk-25* | head -1)"
PROGUARD="$(ls "$ROOT"/.tools/proguard/proguard-*/lib/proguard.jar | head -1)"
SENTINEL_PY="${SENTINEL_PY:-python}"
KEY="$ROOT/.release/keys/release.pem"
KEYRING="$ROOT/.release/keys/keyring.json"
PE="$HOME/.m2/repository/com/github/retrooper/packetevents-api/2.14.0/packetevents-api-2.14.0.jar"

for path in "$MVN" "$JDK21" "$JDK25" "$PROGUARD" "$KEY" "$KEYRING" "$PE"; do
    if [ ! -e "$path" ]; then
        echo "missing required path: $path" >&2
        exit 1
    fi
done

mkdir -p "$ROOT/dist/plain" "$ROOT/dist/obf" "$ROOT/dist/pre"
ASM_WIN="$(cygpath -m "$ROOT/.tools/asm/asm-9.8.jar")"
STRINGCRYPT_WIN="$(cygpath -m "$ROOT/tools/stringcrypt/classes")"
for path in "$ASM_WIN" "$STRINGCRYPT_WIN"; do
    if [ ! -e "$path" ]; then
        echo "missing string-encryption path: $path" >&2
        exit 1
    fi
done

build() {
    local profile="$1" home="$2" suffix="$3"
    echo "== build $profile =="
    (cd "$ROOT/aegishider-integrated" && \
        JAVA_HOME="$home" PATH="$home/bin:$ROOT/.tools/apache-maven-3.9.9/bin:$PATH" \
        "$MVN" -B -o -P"$profile" -Dmaven.test.skip=true clean package)
    cp "$ROOT/aegishider-integrated/target/Aegishider-4.0.2-$suffix.jar" "$ROOT/dist/plain/"
}

paper_api_jar() {
    local version="$1"
    find "$HOME/.m2/repository/io/papermc/paper/paper-api/$version" -maxdepth 1 \
        -name "paper-api-$version.jar" | head -1
}

obfuscate() {
    local suffix="$1" paper_api="$2"
    echo "== string-encrypt $suffix =="
    "$JDK21/bin/java" -cp "$ASM_WIN;$STRINGCRYPT_WIN" StringEncryptor \
        "$(cygpath -m "$ROOT/dist/plain/Aegishider-4.0.2-$suffix.jar")" \
        "$(cygpath -m "$ROOT/dist/pre/Aegishider-4.0.2-$suffix.jar")"
    echo "== obfuscate $suffix =="
    "$SENTINEL_PY" -m sentinel_shield.cli jar obfuscate \
        "$ROOT/dist/pre/Aegishider-4.0.2-$suffix.jar" \
        --out "$ROOT/dist/obf/Aegishider-4.0.2-$suffix.jar" \
        --profile balanced \
        --proguard "$PROGUARD" \
        --jdk-home "$JDK21" \
        --java "$JDK21/bin/java.exe" \
        --library "$paper_api" \
        --library "$PE" \
        --keep-package dev.audismp.aegishider.libs.fastutil \
        --strict-secrets \
        --signing-key "$KEY" \
        --keyring "$KEYRING"
}

build mc1211  "$JDK21" mc1.21.1
build mc1214  "$JDK21" mc1.21.4
build mc1215  "$JDK21" mc1.21.5
build mc12111 "$JDK21" mc1.21.11
build mc261   "$JDK25" mc26.1
build mc263   "$JDK25" mc26.3

obfuscate mc1.21.1  "$(paper_api_jar 1.21.1-R0.1-SNAPSHOT)"
obfuscate mc1.21.4  "$(paper_api_jar 1.21.4-R0.1-SNAPSHOT)"
obfuscate mc1.21.5  "$(paper_api_jar 1.21.5-R0.1-SNAPSHOT)"
obfuscate mc1.21.11 "$(paper_api_jar 1.21.11-R0.1-SNAPSHOT)"
obfuscate mc26.1    "$(paper_api_jar 26.1.2.build.74-stable)"
obfuscate mc26.3    "$(paper_api_jar 26.3.build.256-stable)"

(cd "$ROOT/dist/obf" && sha256sum *.jar > SHA256SUMS)
echo "release artifacts:"
ls -la "$ROOT/dist/obf"
