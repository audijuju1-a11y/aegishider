package dev.audismp.aegishider;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Runtime decoder for the string-encryption release pass. The release tool encrypts
 * plugin string constants with the same key; ProGuard then renames this class/method.
 * Keep the key byte array in sync with tools/stringcrypt/StringEncryptor.java.
 */
public final class StringCipher {

    private static final byte[] KEY = new byte[]{
            0x4A, 0x17, (byte) 0x9C, 0x33, 0x6E, (byte) 0xB5, 0x21, 0x7D,
            (byte) 0xC4, 0x58, 0x0F, (byte) 0xE2, 0x69, 0x2B, (byte) 0x88, 0x51
    };
    private static final ConcurrentHashMap<String, String> CACHE = new ConcurrentHashMap<>();

    private StringCipher() {
    }

    public static String decode(String encoded) {
        if (encoded == null || encoded.isEmpty()) {
            return encoded;
        }
        return CACHE.computeIfAbsent(encoded, StringCipher::decode0);
    }

    private static String decode0(String encoded) {
        byte[] bytes = Base64.getDecoder().decode(encoded);
        for (int i = 0; i < bytes.length; i++) {
            bytes[i] ^= KEY[i % KEY.length];
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }
}
