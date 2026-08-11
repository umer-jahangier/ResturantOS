package io.restaurantos.file.service;

import io.restaurantos.file.exception.InvalidImageException;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;

/**
 * Server-side enforcement for uploads declared as images (19b-01).
 *
 * <h2>Why the declared Content-Type is not consulted</h2>
 *
 * <p>The {@code Content-Type} on a multipart part is supplied by the client and is trivially
 * forged: {@code curl -F 'file=@payload.exe;type=image/png'} produces a part that passes any
 * header-only check, and so does a browser after two lines in devtools. A check that reads it
 * is not a weak control, it is a decorative one — it stops exactly the users who were not
 * attacking. The same is true of the file extension.
 *
 * <p>So this reads the bytes. The first few bytes of a real JPEG, PNG or WebP are fixed by
 * their container formats, and a file that does not start with them is not one of those
 * formats no matter what it is called or labelled.
 *
 * <p>This is a format check, not an antivirus. It guarantees the stored object is a real image
 * container — enough that serving it back with an image content type cannot be turned into
 * "the server hands out an executable that a browser will run" — and it deliberately does not
 * claim to guarantee the file is harmless. A malformed-but-valid-header image that exploits a
 * decoder is out of scope here and belongs to whatever renders it.
 *
 * <h2>Why the cap is enforced here and not only in the browser</h2>
 *
 * <p>A client-side size limit is a suggestion. The gateway accepts a direct POST from anything
 * holding a token, and {@code spring.servlet.multipart.max-file-size} is 50 MB service-wide
 * because other (future) upload purposes legitimately need it. 2 MiB is checked before a byte
 * reaches MinIO, so an oversized menu photo costs a rejected request rather than storage and
 * a tenant's quota.
 */
@Component
public class ImageUploadPolicy {

    /**
     * Opt-in marker. Only uploads that declare this purpose are held to image rules, so the
     * (currently nonexistent, but planned) invoice-scan and GRN-photo uploads are unaffected by
     * this phase and do not inherit a 2 MiB PDF-hostile cap by accident.
     */
    public static final String MENU_ITEM_IMAGE = "MENU_ITEM_IMAGE";

    /** 2 MiB. A menu photo that needs more than this needs resizing, not more bytes. */
    public static final long MAX_IMAGE_BYTES = 2L * 1024 * 1024;

    public static final Set<String> ALLOWED_CONTENT_TYPES =
            Set.of("image/jpeg", "image/png", "image/webp");

    /** Number of leading bytes needed to identify every format below (WebP needs 12). */
    private static final int SNIFF_LENGTH = 12;

    private static final byte[] JPEG_MAGIC = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF};
    private static final byte[] PNG_MAGIC =
            {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    private static final byte[] RIFF_MAGIC = {'R', 'I', 'F', 'F'};
    private static final byte[] WEBP_MAGIC = {'W', 'E', 'B', 'P'};

    /**
     * @param purpose the client-declared upload purpose; anything other than
     *                {@link #MENU_ITEM_IMAGE} is not an image upload and is left alone
     * @return the content type to STORE — always derived from the sniffed bytes, never from the
     *         client's header, so the download response cannot be made to echo an attacker's
     *         chosen type back to a browser
     */
    public String enforce(MultipartFile file, String purpose) {
        if (!MENU_ITEM_IMAGE.equalsIgnoreCase(purpose)) {
            return null;
        }

        if (file == null || file.isEmpty()) {
            throw reject("Choose an image file to upload.");
        }

        // Checked BEFORE reading the bytes: getSize() is the already-buffered multipart size, so
        // this rejects an oversized upload without a second copy of it in heap.
        if (file.getSize() > MAX_IMAGE_BYTES) {
            throw reject("Image is " + humanSize(file.getSize())
                    + ". The maximum is " + humanSize(MAX_IMAGE_BYTES) + " — try a smaller photo.");
        }

        String sniffed = sniff(file);
        if (sniffed == null) {
            throw reject("That file is not a JPEG, PNG or WebP image. "
                    + "Renaming a file does not change what it is — re-export it as an image.");
        }
        return sniffed;
    }

    /**
     * Reads only the first {@value #SNIFF_LENGTH} bytes, via the stream rather than
     * {@code getBytes()} — the caller reads the full content itself afterwards and there is no
     * reason to hold two copies of a 2 MiB upload to look at twelve bytes.
     *
     * @return the real content type, or {@code null} if the bytes are not a supported image
     */
    private String sniff(MultipartFile file) {
        byte[] head = new byte[SNIFF_LENGTH];
        int read;
        try (InputStream in = file.getInputStream()) {
            read = in.readNBytes(head, 0, SNIFF_LENGTH);
        } catch (IOException e) {
            throw reject("Could not read the uploaded file.");
        }
        if (read < 3) {
            return null;
        }

        if (startsWith(head, read, JPEG_MAGIC)) {
            return "image/jpeg";
        }
        if (startsWith(head, read, PNG_MAGIC)) {
            return "image/png";
        }
        // WebP is a RIFF container: "RIFF" <4-byte little-endian length> "WEBP". Both halves
        // must match — "RIFF" alone is also how WAV and AVI start.
        if (read >= 12 && startsWith(head, read, RIFF_MAGIC)
                && Arrays.equals(head, 8, 12, WEBP_MAGIC, 0, 4)) {
            return "image/webp";
        }
        return null;
    }

    private static boolean startsWith(byte[] data, int dataLength, byte[] prefix) {
        if (dataLength < prefix.length) {
            return false;
        }
        return Arrays.equals(data, 0, prefix.length, prefix, 0, prefix.length);
    }

    /**
     * Mapped to 422 by {@code FileController}'s local handler. Deliberately NOT a
     * {@code ResponseStatusException} — see {@link InvalidImageException} for the 500 that
     * produced.
     */
    private InvalidImageException reject(String message) {
        return new InvalidImageException(message);
    }

    private static String humanSize(long bytes) {
        if (bytes < 1024) {
            return bytes + " B";
        }
        if (bytes < 1024 * 1024) {
            return String.format(Locale.ROOT, "%.0f KB", bytes / 1024.0);
        }
        return String.format(Locale.ROOT, "%.1f MB", bytes / (1024.0 * 1024.0));
    }
}
