#!/usr/bin/env bash
# Local, reproducible hardening build for the six Paper targets:
#   compile -> string encryption (ASM) -> ProGuard rename/strip -> SHA256SUMS.
# This is the offline substitute for the Sentinel Shield pipeline; it needs no
# release private key and never modifies gameplay classes beyond renaming/strings.
#
# Required environment:
#   JAVA21_HOME / JAVA25_HOME  JDK homes
#   MVN                        Maven executable
#   PROGUARD_JAR               proguard.jar (7.10+)
#   ASM_JAR                    asm-9.8.jar
#   STRINGCRYPT_CLASSES        output dir for tools/stringcrypt/StringEncryptor.class
# Optional:
#   PE_JAR                     packetevents-api-2.14.0.jar
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${VERSION:-4.0.2}"
: "${JAVA21_HOME:?JAVA21_HOME is required}"
: "${JAVA25_HOME:?JAVA25_HOME is required}"
: "${MVN:?MVN is required}"
: "${PROGUARD_JAR:?PROGUARD_JAR is required}"
: "${ASM_JAR:?ASM_JAR is required}"
: "${STRINGCRYPT_CLASSES:?STRINGCRYPT_CLASSES is required}"
PE_JAR="${PE_JAR:-$HOME/.m2/repository/com/github/retrooper/packetevents-api/2.14.0/packetevents-api-2.14.0.jar}"

export PATH="$JAVA21_HOME/bin:$JAVA25_HOME/bin:$PATH"
mkdir -p "$ROOT/dist/plain" "$ROOT/dist/pre" "$ROOT/dist/obf"
mkdir -p "$STRINGCRYPT_CLASSES"
if [ ! -f "$STRINGCRYPT_CLASSES/StringEncryptor.class" ]; then
    "$JAVA21_HOME/bin/javac" -cp "$ASM_JAR" -d "$STRINGCRYPT_CLASSES" \
        "$ROOT/tools/stringcrypt/StringEncryptor.java"
fi

paper_api_jar() {
    local version="$1"
    find "$HOME/.m2/repository/io/papermc/paper/paper-api/$version" -maxdepth 1 \
        -name "paper-api-$version.jar" 2>/dev/null | head -1
}

build_one() {
    local profile="$1" suffix="$2" paper_version="$3" java_major="$4"
    local home jdk_label
    if [ "$java_major" = "25" ]; then home="$JAVA25_HOME"; else home="$JAVA21_HOME"; fi
    jdk_label="$home"

    echo "== build $profile ($suffix, Java $java_major) =="
    (cd "$ROOT/aegishider-integrated" && \
        JAVA_HOME="$home" PATH="$home/bin:$PATH" \
        "$MVN" -B -P"$profile" -Dmaven.test.skip=true clean package)
    cp "$ROOT/aegishider-integrated/target/Aegishider-$VERSION-$suffix.jar" "$ROOT/dist/plain/"

    echo "== string-encrypt $suffix =="
    "$JAVA21_HOME/bin/java" -cp "$ASM_JAR;$STRINGCRYPT_CLASSES" StringEncryptor \
        "$(cygpath -m "$ROOT/dist/plain/Aegishider-$VERSION-$suffix.jar" 2>/dev/null || echo "$ROOT/dist/plain/Aegishider-$VERSION-$suffix.jar")" \
        "$(cygpath -m "$ROOT/dist/pre/Aegishider-$VERSION-$suffix.jar" 2>/dev/null || echo "$ROOT/dist/pre/Aegishider-$VERSION-$suffix.jar")"

    local paper_jar
    paper_jar="$(paper_api_jar "$paper_version")"
    if [ -z "$paper_jar" ]; then
        echo "missing paper-api $paper_version in ~/.m2" >&2
        exit 1
    fi
    if [ ! -f "$PE_JAR" ]; then
        echo "missing PacketEvents API jar: $PE_JAR" >&2
        exit 1
    fi

    echo "== obfuscate $suffix (ProGuard) =="
    "$home/bin/java" -jar "$PROGUARD_JAR" "@$ROOT/aegishider-integrated/proguard.conf" \
        -injars "$ROOT/dist/pre/Aegishider-$VERSION-$suffix.jar" \
        -outjars "$ROOT/dist/obf/Aegishider-$VERSION-$suffix.jar" \
        -libraryjars "$paper_jar" \
        -libraryjars "$PE_JAR" \
        -libraryjars "$home/jmods/java.base.jmod(!**.jar;!module-info.class)" \
        -libraryjars "$home/jmods/java.logging.jmod(!**.jar;!module-info.class)" \
        -libraryjars "$home/jmods/java.desktop.jmod(!**.jar;!module-info.class)" \
        -libraryjars "$home/jmods/java.management.jmod(!**.jar;!module-info.class)" \
        -libraryjars "$home/jmods/java.naming.jmod(!**.jar;!module-info.class)" \
        -libraryjars "$home/jmods/java.sql.jmod(!**.jar;!module-info.class)" \
        -libraryjars "$home/jmods/java.xml.jmod(!**.jar;!module-info.class)" \
        -libraryjars "$home/jmods/jdk.unsupported.jmod(!**.jar;!module-info.class)" \
        2>&1 | tail -8

    local entries
    entries="$(unzip -l "$ROOT/dist/obf/Aegishider-$VERSION-$suffix.jar" 2>/dev/null || true)"
    if ! grep -q "dev/audismp/aegishider/AegishiderPlugin.class" <<< "$entries"; then
        echo "obfuscated $suffix is missing the plugin entry class" >&2
        exit 1
    fi
    if ! grep -q "plugin.yml" <<< "$entries"; then
        echo "obfuscated $suffix is missing plugin.yml" >&2
        exit 1
    fi
}

build_one mc1211  mc1.21.1  1.21.1-R0.1-SNAPSHOT   21
build_one mc1214  mc1.21.4  1.21.4-R0.1-SNAPSHOT   21
build_one mc1215  mc1.21.5  1.21.5-R0.1-SNAPSHOT   21
build_one mc12111 mc1.21.11 1.21.11-R0.1-SNAPSHOT  21
build_one mc261   mc26.1    26.1.2.build.74-stable 25
build_one mc263   mc26.3    26.3.build.256-stable  25

(cd "$ROOT/dist/obf" && sha256sum *.jar > SHA256SUMS)
{
    echo "Aegishider $VERSION hardened local build"
    echo "date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "jdk21=$JAVA21_HOME"
    echo "jdk25=$JAVA25_HOME"
    echo "proguard=$PROGUARD_JAR"
} > "$ROOT/dist/obf/BUILD-INFO.txt"

echo "hardened artifacts:"
ls -lh "$ROOT/dist/obf"
