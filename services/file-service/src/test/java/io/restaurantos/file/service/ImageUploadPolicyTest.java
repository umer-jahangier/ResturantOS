package io.restaurantos.file.service;

import io.restaurantos.file.exception.InvalidImageException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * The product's first file input ships in 19b, so this is the test that fixes what "enforced"
 * means for every upload after it.
 *
 * <p>The case that matters most is {@link #aRenamedExecutableLabelledAsPngIsRejected()}. A
 * header-only check — {@code file.getContentType().startsWith("image/")} — passes that payload,
 * and it is one flag on {@code curl}. Every assertion here that involves a mislabelled file is
 * an assertion that the policy read the BYTES.
 */
class ImageUploadPolicyTest {

    private final ImageUploadPolicy policy = new ImageUploadPolicy();

    private static final byte[] PNG_HEADER = {
            (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13};
    private static final byte[] JPEG_HEADER = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0, 16};

    private static byte[] webp(int payloadBytes) {
        byte[] data = new byte[Math.max(12, payloadBytes)];
        System.arraycopy("RIFF".getBytes(StandardCharsets.US_ASCII), 0, data, 0, 4);
        System.arraycopy("WEBP".getBytes(StandardCharsets.US_ASCII), 0, data, 8, 4);
        return data;
    }

    private MockMultipartFile file(String name, String declaredType, byte[] content) {
        return new MockMultipartFile("file", name, declaredType, content);
    }

    // ── Accepted formats ────────────────────────────────────────────────────────────────────

    @Test
    void realPngIsAcceptedAndStoredAsImagePng() {
        String stored = policy.enforce(file("dish.png", "image/png", PNG_HEADER),
                ImageUploadPolicy.MENU_ITEM_IMAGE);
        assertThat(stored).isEqualTo("image/png");
    }

    @Test
    void realJpegIsAccepted() {
        assertThat(policy.enforce(file("dish.jpg", "image/jpeg", JPEG_HEADER),
                ImageUploadPolicy.MENU_ITEM_IMAGE)).isEqualTo("image/jpeg");
    }

    @Test
    void realWebpIsAccepted() {
        assertThat(policy.enforce(file("dish.webp", "image/webp", webp(32)),
                ImageUploadPolicy.MENU_ITEM_IMAGE)).isEqualTo("image/webp");
    }

    @Test
    @DisplayName("the STORED content type comes from the bytes, not from the client's header")
    void storedTypeIgnoresAMisleadingButHarmlessDeclaredType() {
        // A real PNG that the client insisted was a JPEG. Stored as what it actually is —
        // download() sets its response Content-Type from this value.
        String stored = policy.enforce(file("dish.jpg", "image/jpeg", PNG_HEADER),
                ImageUploadPolicy.MENU_ITEM_IMAGE);
        assertThat(stored).isEqualTo("image/png");
    }

    // ── Rejected content ────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a renamed executable labelled image/png is rejected — the check reads bytes")
    void aRenamedExecutableLabelledAsPngIsRejected() {
        // Mach-O / PE-ish leading bytes; the point is only that they are not an image header.
        byte[] notAnImage = {0x4D, 0x5A, (byte) 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0, 0, 0};

        InvalidImageException ex = catchThrowableOfType(
                () -> policy.enforce(file("totally-a-photo.png", "image/png", notAnImage),
                        ImageUploadPolicy.MENU_ITEM_IMAGE),
                InvalidImageException.class);

        // FileController maps this type to 422. It must NOT be a ResponseStatusException:
        // shared-lib's GlobalExceptionHandler has no mapping for those and its catch-all turns
        // them into 500 INTERNAL_ERROR, which is what shipped until it was caught live.
        assertThat(ex.getMessage()).contains("not a JPEG, PNG or WebP");
    }

    @Test
    @DisplayName("RIFF alone is not enough — WAV and AVI start the same way as WebP")
    void aRiffContainerThatIsNotWebpIsRejected() {
        byte[] wav = new byte[16];
        System.arraycopy("RIFF".getBytes(StandardCharsets.US_ASCII), 0, wav, 0, 4);
        System.arraycopy("WAVE".getBytes(StandardCharsets.US_ASCII), 0, wav, 8, 4);

        assertThatThrownBy(() -> policy.enforce(file("clip.webp", "image/webp", wav),
                ImageUploadPolicy.MENU_ITEM_IMAGE))
                .isInstanceOf(InvalidImageException.class);
    }

    @Test
    void aPdfIsRejectedEvenWhenNamedWithAnImageExtension() {
        byte[] pdf = "%PDF-1.7\n%âã".getBytes(StandardCharsets.ISO_8859_1);
        assertThatThrownBy(() -> policy.enforce(file("menu.png", "image/png", pdf),
                ImageUploadPolicy.MENU_ITEM_IMAGE))
                .isInstanceOf(InvalidImageException.class);
    }

    @Test
    void anEmptyFileIsRejected() {
        assertThatThrownBy(() -> policy.enforce(file("empty.png", "image/png", new byte[0]),
                ImageUploadPolicy.MENU_ITEM_IMAGE))
                .isInstanceOf(InvalidImageException.class);
    }

    @Test
    void aTruncatedFileTooShortToIdentifyIsRejected() {
        assertThatThrownBy(() -> policy.enforce(file("tiny.png", "image/png", new byte[]{0x01, 0x02}),
                ImageUploadPolicy.MENU_ITEM_IMAGE))
                .isInstanceOf(InvalidImageException.class);
    }

    // ── Size cap ────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("the size cap is server-side — a client limit is only a suggestion")
    void anOversizedImageIsRejectedWithItsActualSize() {
        byte[] tooBig = new byte[(int) ImageUploadPolicy.MAX_IMAGE_BYTES + 1];
        System.arraycopy(PNG_HEADER, 0, tooBig, 0, PNG_HEADER.length);

        InvalidImageException ex = catchThrowableOfType(
                () -> policy.enforce(file("huge.png", "image/png", tooBig),
                        ImageUploadPolicy.MENU_ITEM_IMAGE),
                InvalidImageException.class);

        assertThat(ex.getMessage()).contains("maximum is 2.0 MB");
    }

    @Test
    void aFileExactlyAtTheCapIsAccepted() {
        byte[] atLimit = new byte[(int) ImageUploadPolicy.MAX_IMAGE_BYTES];
        System.arraycopy(PNG_HEADER, 0, atLimit, 0, PNG_HEADER.length);
        assertThat(policy.enforce(file("limit.png", "image/png", atLimit),
                ImageUploadPolicy.MENU_ITEM_IMAGE)).isEqualTo("image/png");
    }

    // ── Opt-in scope ────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("uploads that do not declare the image purpose are untouched by this policy")
    void otherPurposesAreNotHeldToImageRules() {
        byte[] pdf = "%PDF-1.7".getBytes(StandardCharsets.US_ASCII);
        assertThat(policy.enforce(file("invoice.pdf", "application/pdf", pdf), null)).isNull();
        assertThat(policy.enforce(file("invoice.pdf", "application/pdf", pdf), "INVOICE_SCAN")).isNull();
    }

    @Test
    void thePurposeMarkerIsCaseInsensitive() {
        assertThat(policy.enforce(file("dish.png", "image/png", PNG_HEADER), "menu_item_image"))
                .isEqualTo("image/png");
    }
}
