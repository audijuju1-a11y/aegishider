import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.RecordComponentVisitor;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Enumeration;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * Post-build string encryption for the Aegishider plugin classes. Skips the shaded
 * FastUtil package and the StringCipher helper. Also drops Record attributes so a
 * decompiler cannot read record component names.
 *
 * usage: java -cp asm.jar:. StringEncryptor <input.jar> <output.jar>
 */
public final class StringEncryptor {

    private static final String HELPER = "dev/audismp/aegishider/StringCipher";
    private static final String DECODE_DESC = "(Ljava/lang/String;)Ljava/lang/String;";
    private static final byte[] KEY = new byte[]{
            0x4A, 0x17, (byte) 0x9C, 0x33, 0x6E, (byte) 0xB5, 0x21, 0x7D,
            (byte) 0xC4, 0x58, 0x0F, (byte) 0xE2, 0x69, 0x2B, (byte) 0x88, 0x51
    };

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("usage: StringEncryptor <input.jar> <output.jar>");
            System.exit(2);
        }
        Path input = Path.of(args[0]);
        Path output = Path.of(args[1]);
        int changed = 0;
        int classes = 0;
        try (ZipFile zip = new ZipFile(input.toFile());
             ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(output))) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                ZipEntry copy = new ZipEntry(entry.getName());
                copy.setTime(0L);
                out.putNextEntry(copy);
                try (InputStream in = zip.getInputStream(entry)) {
                    byte[] bytes = readAll(in);
                    if (shouldTransform(entry.getName())) {
                        bytes = transform(bytes);
                        changed += countStrings(bytes);
                        classes++;
                    }
                    out.write(bytes);
                }
                out.closeEntry();
            }
        }
        System.out.println("stringcrypt: " + classes + " classes, " + changed + " constants -> " + output);
    }

    private static boolean shouldTransform(String name) {
        return name.startsWith("dev/audismp/aegishider/")
                && name.endsWith(".class")
                && !name.startsWith("dev/audismp/aegishider/libs/fastutil/")
                && !name.equals(HELPER + ".class");
    }

    private static int countStrings(byte[] ignored) {
        return 1; // classes, not constants; the log line is approximate
    }

    private static byte[] transform(byte[] bytes) {
        ClassReader reader = new ClassReader(bytes);
        ClassWriter writer = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        ClassVisitor visitor = new ClassVisitor(Opcodes.ASM9, writer) {
            @Override
            public MethodVisitor visitMethod(int access, String name, String descriptor,
                                             String signature, String[] exceptions) {
                MethodVisitor delegate = super.visitMethod(access, name, descriptor, signature, exceptions);
                return new MethodVisitor(Opcodes.ASM9, delegate) {
                    @Override
                    public void visitLdcInsn(Object value) {
                        if (value instanceof String string && !string.isEmpty()) {
                            super.visitLdcInsn(encrypt(string));
                            super.visitMethodInsn(Opcodes.INVOKESTATIC, HELPER, "decode",
                                    DECODE_DESC, false);
                        } else {
                            super.visitLdcInsn(value);
                        }
                    }
                };
            }

            @Override
            public RecordComponentVisitor visitRecordComponent(String name, String descriptor,
                                                                String signature) {
                return null; // drop the Record attribute (names leak otherwise)
            }
        };
        reader.accept(visitor, 0);
        return writer.toByteArray();
    }

    private static String encrypt(String value) {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        for (int i = 0; i < bytes.length; i++) {
            bytes[i] ^= KEY[i % KEY.length];
        }
        return Base64.getEncoder().encodeToString(bytes);
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = in.read(chunk)) > 0) {
            buffer.write(chunk, 0, read);
        }
        return buffer.toByteArray();
    }
}
