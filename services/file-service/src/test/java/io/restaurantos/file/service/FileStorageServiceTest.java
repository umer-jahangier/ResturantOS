package io.restaurantos.file.service;

import io.minio.GetObjectArgs;
import io.minio.GetObjectResponse;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.errors.MinioException;
import io.restaurantos.file.dto.FileDtos.FileUploadResponse;
import io.restaurantos.file.entity.FileMetadataEntity;
import io.restaurantos.file.exception.QuotaExceededException;
import io.restaurantos.file.repository.FileMetadataRepository;
import io.restaurantos.shared.tenant.TenantContext;
import okhttp3.Headers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.InputStreamResource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link FileStorageService} is the only place in the fleet where a tenant's bytes, its quota
 * counter and its object-store prefix have to stay in agreement, and every one of those three can
 * be left inconsistent by a failure halfway through an upload. These tests are mostly about the
 * halves: quota reserved but MinIO refused, bytes unreadable after the reservation, a row that
 * would outlive the object it points at.
 *
 * <p>Three refusals carry most of the weight:
 *
 * <ul>
 *   <li>{@link #quotaIsRefusedBeforeAnythingIsWrittenOrRecorded()} — the reservation is the gate,
 *       so a rejection must leave MinIO and the table untouched AND must not "give back" a
 *       reservation that was never taken.
 *   <li>{@link #enforcedContentTypeIsWhatGetsStoredNotTheClientsDeclaredHeader()} — the stored
 *       content type is what {@link FileStorageService#download} echoes to a browser. If the
 *       client's forged header wins here, {@code ImageUploadPolicy} sniffing the bytes upstream
 *       bought nothing.
 *   <li>{@link #aFileOneByteOverTheCeilingIsRefusedWithoutTouchingStorage()} — the internal read
 *       seam's only bound on how much it will buffer.
 * </ul>
 *
 * <p>Everything MinIO-shaped is a mock: the collaborators are an interface
 * ({@code FileMetadataRepository}) and two plain classes, so none of this needs a container.
 */
@ExtendWith(MockitoExtension.class)
class FileStorageServiceTest {

    private static final String BUCKET = "restaurantos-files";

    private static final UUID TENANT = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID OTHER_TENANT = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID USER = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID FILE_ID = UUID.fromString("44444444-4444-4444-4444-444444444444");

    /**
     * SHA-256 of the five ASCII bytes {@code hello}, hard-coded rather than recomputed. A test that
     * calls {@code MessageDigest} to check {@code MessageDigest} asserts only that the service ran
     * some digest, not that it ran the right one over the right bytes.
     */
    private static final String SHA256_OF_HELLO =
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

    @Mock
    private MinioClient minioClient;
    @Mock
    private QuotaService quotaService;
    @Mock
    private FileMetadataRepository fileMetadataRepository;
    @Mock
    private TenantContext tenantContext;

    private FileStorageService service;

    @BeforeEach
    void setUp() {
        service = new FileStorageService(
                minioClient, quotaService, fileMetadataRepository, tenantContext, BUCKET);
    }

    // ── Fixtures ────────────────────────────────────────────────────────────────────────────

    private static byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private static MockMultipartFile file(String originalFilename, String declaredType, byte[] content) {
        return new MockMultipartFile("file", originalFilename, declaredType, content);
    }

    private static GetObjectResponse minioBody(byte[] payload) {
        return new GetObjectResponse(
                Headers.of(), BUCKET, "us-east-1", "some/object/key", new ByteArrayInputStream(payload));
    }

    private static FileMetadataEntity meta(String objectKey, String filename,
                                           String contentType, long sizeBytes, String sha256) {
        FileMetadataEntity e = new FileMetadataEntity();
        e.setTenantId(TENANT);
        e.setUploadedBy(USER);
        e.setObjectKey(objectKey);
        e.setOriginalFilename(filename);
        e.setContentType(contentType);
        e.setSizeBytes(sizeBytes);
        e.setSha256(sha256);
        return e;
    }

    /**
     * The entity's id is assigned by the database, not by {@code upload}. Modelling that is the
     * only way to see which of the two UUIDs in play ends up in the download URL.
     */
    private UUID stubSaveAssigningId() {
        UUID assigned = UUID.fromString("99999999-9999-9999-9999-999999999999");
        when(fileMetadataRepository.save(any(FileMetadataEntity.class))).thenAnswer(invocation -> {
            FileMetadataEntity entity = invocation.getArgument(0);
            entity.setId(assigned);
            return entity;
        });
        return assigned;
    }

    private FileMetadataEntity capturedSave() {
        ArgumentCaptor<FileMetadataEntity> captor = ArgumentCaptor.forClass(FileMetadataEntity.class);
        verify(fileMetadataRepository).save(captor.capture());
        return captor.getValue();
    }

    private PutObjectArgs capturedPut() throws Exception {
        ArgumentCaptor<PutObjectArgs> captor = ArgumentCaptor.forClass(PutObjectArgs.class);
        verify(minioClient).putObject(captor.capture());
        return captor.getValue();
    }

    // ── upload: the quota gate ──────────────────────────────────────────────────────────────

    /**
     * The reservation is the gate. If it refuses, nothing downstream may have run — and, less
     * obviously, {@code releaseQuota} must NOT run either: the reservation was rolled back inside
     * {@code checkQuota} already, so a second decrement here would permanently under-count the
     * tenant's usage and eventually hand them free storage.
     */
    @Test
    void quotaIsRefusedBeforeAnythingIsWrittenOrRecorded() {
        MockMultipartFile upload = file("menu.png", "image/png", bytes("hello"));
        doThrow(new QuotaExceededException("STORAGE_GB", 900L, 1000L))
                .when(quotaService).checkQuota(TENANT, 5L);

        Throwable thrown = catchThrowable(() -> service.upload(upload, TENANT, USER));

        assertThat(thrown).isInstanceOf(QuotaExceededException.class);
        QuotaExceededException refusal = (QuotaExceededException) thrown;
        assertThat(refusal.getQuotaType()).isEqualTo("STORAGE_GB");
        assertThat(refusal.getUsedBytes()).isEqualTo(900L);
        assertThat(refusal.getLimitBytes()).isEqualTo(1000L);
        assertThat(refusal)
                .hasMessageContaining("used=900")
                .hasMessageContaining("limit=1000");

        verifyNoInteractions(minioClient);
        verifyNoInteractions(fileMetadataRepository);
        verify(quotaService, never()).releaseQuota(any(UUID.class), anyLong());
    }

    // ── upload: what content type gets recorded ─────────────────────────────────────────────

    /**
     * The whole point of {@code enforcedContentType}. {@code download} builds its response
     * Content-Type from the STORED value, so if the client's {@code image/png} label survived
     * here, an executable would be served back to a browser wearing it.
     */
    @Test
    void enforcedContentTypeIsWhatGetsStoredNotTheClientsDeclaredHeader() throws Exception {
        MockMultipartFile forged =
                file("totally-a-photo.png", "image/png", bytes("not really a png"));
        stubSaveAssigningId();

        FileUploadResponse response =
                service.upload(forged, TENANT, USER, "application/x-msdownload");

        assertThat(response.contentType()).isEqualTo("application/x-msdownload");
        assertThat(capturedSave().getContentType()).isEqualTo("application/x-msdownload");
        // and the object store is told the same thing, so the two never disagree later
        assertThat(capturedPut().contentType().toString()).isEqualTo("application/x-msdownload");
    }

    @Test
    void withNoEnforcedTypeTheClientsDeclaredTypeIsUsed() throws Exception {
        MockMultipartFile upload = file("invoice.pdf", "application/pdf", bytes("hello"));
        stubSaveAssigningId();

        FileUploadResponse response = service.upload(upload, TENANT, USER);

        assertThat(response.contentType()).isEqualTo("application/pdf");
        assertThat(capturedSave().getContentType()).isEqualTo("application/pdf");
    }

    /**
     * A multipart part with neither a filename nor a Content-Type is legal on the wire. Neither
     * may become {@code null} in the row: {@code content_type} and {@code original_filename} are
     * both NOT NULL, and a null content type would blow up {@code download} on the way back out.
     */
    @Test
    void aPartWithNoFilenameAndNoDeclaredTypeGetsSafeDefaults() throws Exception {
        MultipartFile headerless = mock(MultipartFile.class);
        when(headerless.getSize()).thenReturn(5L);
        when(headerless.getOriginalFilename()).thenReturn(null);
        when(headerless.getContentType()).thenReturn(null);
        when(headerless.getBytes()).thenReturn(bytes("hello"));
        stubSaveAssigningId();

        FileUploadResponse response = service.upload(headerless, TENANT, USER);

        assertThat(response.contentType()).isEqualTo("application/octet-stream");
        assertThat(response.objectKey()).endsWith("/unnamed");
        FileMetadataEntity saved = capturedSave();
        assertThat(saved.getOriginalFilename()).isEqualTo("unnamed");
        assertThat(saved.getContentType()).isEqualTo("application/octet-stream");
    }

    // ── upload: filename sanitisation ───────────────────────────────────────────────────────

    /**
     * The object key is {@code {tenantId}/{uuid}/{filename}} and tenant isolation in the bucket is
     * that prefix and nothing else. A filename carrying separators must not be able to add
     * segments, or a caller picks their own prefix — including another tenant's.
     */
    @Test
    void separatorsInTheFilenameCannotAddSegmentsToTheObjectKey() throws Exception {
        MockMultipartFile traversal = file("../../etc/passwd", "text/plain", bytes("hello"));
        stubSaveAssigningId();

        FileUploadResponse response = service.upload(traversal, TENANT, USER);

        assertThat(response.objectKey().split("/")).hasSize(3);
        assertThat(response.objectKey())
                .startsWith(TENANT + "/")
                .endsWith("/.._.._etc_passwd");
        assertThat(capturedSave().getOriginalFilename()).isEqualTo(".._.._etc_passwd");
    }

    @Test
    void windowsSeparatorsAndReservedCharactersAreFlattenedToo() throws Exception {
        MockMultipartFile hostile =
                file("..\\win\\sys32\\cmd.exe:evil*?\"<>|", "application/octet-stream", bytes("hello"));
        stubSaveAssigningId();

        FileUploadResponse response = service.upload(hostile, TENANT, USER);

        assertThat(capturedSave().getOriginalFilename())
                .isEqualTo(".._win_sys32_cmd.exe_evil______");
        assertThat(response.objectKey().split("/")).hasSize(3);
    }

    /** 200 characters exactly is still under the cap, so it must survive untouched. */
    @Test
    void aFilenameExactlyAtTheLengthCapIsNotTrimmed() throws Exception {
        String exactly200 = "b".repeat(196) + ".png";
        assertThat(exactly200).hasSize(200);
        stubSaveAssigningId();

        service.upload(file(exactly200, "image/png", bytes("hello")), TENANT, USER);

        assertThat(capturedSave().getOriginalFilename()).isEqualTo(exactly200);
    }

    /**
     * One character over, and the trim takes the TAIL — deliberately, so the extension survives.
     * Trimming the head instead would leave every long upload named {@code aaaa...} with no
     * extension, which is what a naive {@code substring(0, 200)} would do.
     */
    @Test
    void aFilenameOverTheLengthCapIsTrimmedFromTheFrontSoTheExtensionSurvives() throws Exception {
        String tooLong = "a".repeat(197) + ".png";
        assertThat(tooLong).hasSize(201);
        stubSaveAssigningId();

        service.upload(file(tooLong, "image/png", bytes("hello")), TENANT, USER);

        String stored = capturedSave().getOriginalFilename();
        assertThat(stored).hasSize(200).endsWith(".png").isEqualTo(tooLong.substring(1));
    }

    // ── upload: the happy path's invariants ─────────────────────────────────────────────────

    /**
     * The row and the object have to describe the same thing, under the caller's tenant prefix,
     * in that order: reserve, write, record. Recording before the write would leave a row pointing
     * at a key that does not exist if MinIO refuses.
     */
    @Test
    void theRowAndTheObjectAgreeAndAreWrittenInReserveWriteRecordOrder() throws Exception {
        MockMultipartFile upload = file("menu.png", "image/png", bytes("hello"));
        stubSaveAssigningId();

        service.upload(upload, TENANT, USER);

        FileMetadataEntity saved = capturedSave();
        assertThat(saved.getTenantId()).isEqualTo(TENANT);
        assertThat(saved.getUploadedBy()).isEqualTo(USER);
        assertThat(saved.getSizeBytes()).isEqualTo(5L);
        assertThat(saved.getOriginalFilename()).isEqualTo("menu.png");
        assertThat(saved.getObjectKey()).startsWith(TENANT + "/").endsWith("/menu.png");

        PutObjectArgs put = capturedPut();
        assertThat(put.bucket()).isEqualTo(BUCKET);
        assertThat(put.object()).isEqualTo(saved.getObjectKey());
        assertThat(put.objectSize()).isEqualTo(5L);

        InOrder order = inOrder(quotaService, minioClient, fileMetadataRepository);
        order.verify(quotaService).checkQuota(TENANT, 5L);
        order.verify(minioClient).putObject(any(PutObjectArgs.class));
        order.verify(fileMetadataRepository).save(any(FileMetadataEntity.class));
    }

    @Test
    void theRecordedDigestIsTheSha256OfTheBytesInLowercaseHex() throws Exception {
        stubSaveAssigningId();

        FileUploadResponse response =
                service.upload(file("hello.txt", "text/plain", bytes("hello")), TENANT, USER);

        assertThat(response.sha256()).isEqualTo(SHA256_OF_HELLO);
        assertThat(response.sha256()).hasSize(64).matches("[0-9a-f]{64}");
        assertThat(capturedSave().getSha256()).isEqualTo(SHA256_OF_HELLO);
    }

    /**
     * Two different UUIDs are in play. The one baked into the object key is generated locally and
     * thrown away; the one the caller is handed back — and which every later download,
     * delete and metadata lookup uses — is the id the database assigned.
     *
     * <p>Asserted rather than assumed because the class javadoc claims the key format allows
     * "direct lookup by fileId without a DB round-trip", and it does not: the key's middle segment
     * is not the file id. Worth revisiting; pinned here so the divergence is at least visible.
     */
    @Test
    void theDownloadUrlUsesThePersistedIdNotTheUuidBakedIntoTheObjectKey() throws Exception {
        UUID assignedByDb = stubSaveAssigningId();

        FileUploadResponse response =
                service.upload(file("menu.png", "image/png", bytes("hello")), TENANT, USER);

        assertThat(response.fileId()).isEqualTo(assignedByDb);
        assertThat(response.downloadUrl())
                .isEqualTo("/api/v1/files/" + assignedByDb + "/download");
        assertThat(response.objectKey()).doesNotContain(assignedByDb.toString());
        assertThat(response.sizeBytes()).isEqualTo(5L);
    }

    // ── upload: the compensating rollbacks ──────────────────────────────────────────────────

    /**
     * MinIO refusing the write is the case the reservation exists for. The bytes are gone, so the
     * reservation must be handed back with the SAME size it was taken with, and no row may be
     * recorded for an object that does not exist.
     */
    @Test
    void whenMinioRejectsTheWriteTheReservationIsHandedBackAndNoRowIsRecorded() throws Exception {
        MockMultipartFile upload = file("menu.png", "image/png", bytes("hello"));
        when(minioClient.putObject(any(PutObjectArgs.class)))
                .thenThrow(new MinioException("bucket is unreachable"));

        assertThatThrownBy(() -> service.upload(upload, TENANT, USER))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("File upload to storage failed")
                .hasMessageContaining("bucket is unreachable");

        verify(quotaService).releaseQuota(TENANT, 5L);
        verify(fileMetadataRepository, never()).save(any(FileMetadataEntity.class));
    }

    /**
     * The content type reaches MinIO's builder, which validates it against RFC 2045 and throws —
     * and the builder call sits INSIDE the try, so a Content-Type header the client made up
     * ({@code Content-Type: garbage} is one curl flag) aborts the upload with a message blaming
     * storage for something storage never saw.
     *
     * <p>The rollback is still correct, which is why this is pinned rather than fixed here: the
     * reservation comes back and no row is written. What is wrong is only the story it tells. If
     * this ever needs to be a 422 alongside {@code InvalidImageException}, this test is the one
     * that has to change.
     */
    @Test
    void aClientDeclaredContentTypeThatIsNotAMediaTypeAbortsTheUploadAsAStorageFailure() {
        MockMultipartFile upload = file("menu.png", "garbage", bytes("hello"));

        assertThatThrownBy(() -> service.upload(upload, TENANT, USER))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("File upload to storage failed")
                .hasMessageContaining("invalid content type 'garbage'")
                .hasCauseInstanceOf(IllegalArgumentException.class);

        verify(quotaService).releaseQuota(TENANT, 5L);
        verify(fileMetadataRepository, never()).save(any(FileMetadataEntity.class));
        verifyNoInteractions(minioClient);
    }

    /**
     * The reservation is taken from {@code getSize()} before the bytes are read, so a part that
     * cannot be read after that point leaks the reservation unless it is released here. The
     * {@link IOException} is deliberately rethrown as-is rather than re-dressed as a storage
     * failure — nothing reached storage.
     */
    @Test
    void whenTheBytesCannotBeReadTheReservationIsHandedBackAndTheIoErrorIsNotRedressed()
            throws Exception {
        MultipartFile broken = mock(MultipartFile.class);
        when(broken.getSize()).thenReturn(42L);
        when(broken.getOriginalFilename()).thenReturn("truncated.png");
        when(broken.getContentType()).thenReturn("image/png");
        when(broken.getBytes()).thenThrow(new IOException("stream closed"));

        assertThatThrownBy(() -> service.upload(broken, TENANT, USER))
                .isInstanceOf(IOException.class)
                .hasMessage("stream closed");

        verify(quotaService).releaseQuota(TENANT, 42L);
        verifyNoInteractions(minioClient);
        verify(fileMetadataRepository, never()).save(any(FileMetadataEntity.class));
    }

    // ── download ────────────────────────────────────────────────────────────────────────────

    /**
     * RLS makes another tenant's file invisible, which arrives here as an empty {@code Optional}.
     * It has to become a 404 with a reason a caller can read — not a 500, and not a storage error
     * that would imply the file exists but is broken.
     */
    @Test
    void downloadingAFileTheTenantCannotSeeIsA404AndNeverReachesStorage() {
        when(fileMetadataRepository.findByIdAndDeletedAtIsNull(FILE_ID)).thenReturn(Optional.empty());

        Throwable thrown = catchThrowable(() -> service.download(FILE_ID));

        assertThat(thrown).isInstanceOf(ResponseStatusException.class);
        ResponseStatusException refusal = (ResponseStatusException) thrown;
        assertThat(refusal.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(refusal.getReason()).isEqualTo("File not found");
        verifyNoInteractions(minioClient);
    }

    @Test
    void downloadServesTheStoredTypeLengthAndFilenameAsAnAttachment() throws Exception {
        FileMetadataEntity stored =
                meta("t/f/report.pdf", "report.pdf", "application/pdf", 1234L, "abc123");
        when(fileMetadataRepository.findByIdAndDeletedAtIsNull(FILE_ID))
                .thenReturn(Optional.of(stored));
        when(minioClient.getObject(any(GetObjectArgs.class))).thenReturn(minioBody(bytes("hello")));

        ResponseEntity<InputStreamResource> response = service.download(FILE_ID);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getHeaders().getContentType()).isEqualTo(MediaType.APPLICATION_PDF);
        assertThat(response.getHeaders().getContentLength()).isEqualTo(1234L);
        assertThat(response.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION))
                .isEqualTo("attachment; filename=\"report.pdf\"");
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getInputStream().readAllBytes()).isEqualTo(bytes("hello"));

        ArgumentCaptor<GetObjectArgs> get = ArgumentCaptor.forClass(GetObjectArgs.class);
        verify(minioClient).getObject(get.capture());
        assertThat(get.getValue().bucket()).isEqualTo(BUCKET);
        assertThat(get.getValue().object()).isEqualTo("t/f/report.pdf");
    }

    /**
     * A row that exists but whose object does not is a genuinely different failure from a row that
     * does not exist, and must not be flattened into the 404 above — a 404 would tell an operator
     * the metadata is missing when what is actually missing is the object.
     */
    @Test
    void anObjectMissingFromStorageIsAStorageFailureNotA404() throws Exception {
        FileMetadataEntity stored =
                meta("t/f/report.pdf", "report.pdf", "application/pdf", 1234L, "abc123");
        when(fileMetadataRepository.findByIdAndDeletedAtIsNull(FILE_ID))
                .thenReturn(Optional.of(stored));
        when(minioClient.getObject(any(GetObjectArgs.class)))
                .thenThrow(new MinioException("no such key"));

        assertThatThrownBy(() -> service.download(FILE_ID))
                .isInstanceOf(RuntimeException.class)
                .isNotInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("File download from storage failed")
                .hasMessageContaining("no such key");
    }

    /**
     * The stored content type is parsed inside the same {@code try} that wraps the MinIO call, so
     * an unparseable one is reported as a storage failure even though storage was fine. Pinned
     * because the message is misleading and someone reading a log will chase the wrong thing —
     * and because it is the reason an unvalidated content type must never reach the table.
     */
    @Test
    void anUnparseableStoredContentTypeSurfacesAsAStorageFailure() throws Exception {
        FileMetadataEntity stored =
                meta("t/f/thing", "thing", "not-a-media-type", 10L, "abc123");
        when(fileMetadataRepository.findByIdAndDeletedAtIsNull(FILE_ID))
                .thenReturn(Optional.of(stored));
        when(minioClient.getObject(any(GetObjectArgs.class))).thenReturn(minioBody(bytes("hello")));

        assertThatThrownBy(() -> service.download(FILE_ID))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("File download from storage failed")
                .hasCauseInstanceOf(IllegalArgumentException.class);
    }

    // ── readForTenant: the /internal/** seam ────────────────────────────────────────────────

    /**
     * This path has no JWT; the tenant arrives as a caller-controlled header. So the tenant is
     * named in the query rather than left to the RLS GUC, and asking for a file under the wrong
     * tenant must come back empty without ever reading the object.
     */
    @Test
    void readForTenantNamesTheTenantInTheQueryAndRefusesAMissOutright() {
        when(fileMetadataRepository.findByIdAndTenantId(FILE_ID, OTHER_TENANT))
                .thenReturn(Optional.empty());

        Optional<FileStorageService.FileContent> result =
                service.readForTenant(FILE_ID, OTHER_TENANT, 4096L);

        assertThat(result).isEmpty();
        verify(fileMetadataRepository).findByIdAndTenantId(FILE_ID, OTHER_TENANT);
        verify(fileMetadataRepository, never()).findByIdAndDeletedAtIsNull(any(UUID.class));
        verifyNoInteractions(minioClient);
    }

    /** The ceiling is inclusive: {@code >} maxBytes is refused, so exactly maxBytes is served. */
    @Test
    void aFileExactlyAtTheCeilingIsServed() throws Exception {
        byte[] payload = new byte[1024];
        Arrays.fill(payload, (byte) 7);
        FileMetadataEntity stored = meta("t/f/logo.png", "logo.png", "image/png", 1024L, "deadbeef");
        when(fileMetadataRepository.findByIdAndTenantId(FILE_ID, TENANT))
                .thenReturn(Optional.of(stored));
        when(minioClient.getObject(any(GetObjectArgs.class))).thenReturn(minioBody(payload));

        Optional<FileStorageService.FileContent> result =
                service.readForTenant(FILE_ID, TENANT, 1024L);

        assertThat(result).isPresent();
        assertThat(result.get().bytes()).isEqualTo(payload);
        assertThat(result.get().contentType()).isEqualTo("image/png");
        assertThat(result.get().sha256()).isEqualTo("deadbeef");
    }

    /**
     * One byte over and the answer is empty — same answer as "wrong tenant", deliberately. The
     * refusal has to land BEFORE the object is opened, because the whole point of the ceiling is
     * to bound what gets buffered into memory.
     */
    @Test
    void aFileOneByteOverTheCeilingIsRefusedWithoutTouchingStorage() {
        FileMetadataEntity stored = meta("t/f/huge.png", "huge.png", "image/png", 1025L, "deadbeef");
        when(fileMetadataRepository.findByIdAndTenantId(FILE_ID, TENANT))
                .thenReturn(Optional.of(stored));

        Optional<FileStorageService.FileContent> result =
                service.readForTenant(FILE_ID, TENANT, 1024L);

        assertThat(result).isEmpty();
        verifyNoInteractions(minioClient);
    }

    /**
     * Absence is {@code empty}; breakage is an exception. Collapsing the two would let a MinIO
     * outage read to a Feign caller as "that tenant has no such file", which is a wrong answer
     * rather than a failure.
     */
    @Test
    void readForTenantThrowsOnAStorageFailureRatherThanReturningEmpty() throws Exception {
        FileMetadataEntity stored = meta("t/f/logo.png", "logo.png", "image/png", 100L, "deadbeef");
        when(fileMetadataRepository.findByIdAndTenantId(FILE_ID, TENANT))
                .thenReturn(Optional.of(stored));
        when(minioClient.getObject(any(GetObjectArgs.class)))
                .thenThrow(new MinioException("connection reset"));

        assertThatThrownBy(() -> service.readForTenant(FILE_ID, TENANT, 4096L))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("File read from storage failed")
                .hasMessageContaining("connection reset");
    }

    // ── listFiles ───────────────────────────────────────────────────────────────────────────

    /**
     * Soft-deleted rows stay in the table forever, so the listing must be the deleted-excluding
     * finder. {@code findAll} would quietly resurrect every deleted file in the UI.
     */
    @Test
    void listFilesAsksOnlyForRowsThatAreNotSoftDeleted() {
        PageRequest page = PageRequest.of(0, 25);
        FileMetadataEntity live = meta("t/f/a.pdf", "a.pdf", "application/pdf", 10L, "abc");
        when(fileMetadataRepository.findByDeletedAtIsNull(page))
                .thenReturn(new PageImpl<>(List.of(live), page, 1));

        Page<FileMetadataEntity> result = service.listFiles(page);

        assertThat(result.getContent()).containsExactly(live);
        assertThat(result.getTotalElements()).isEqualTo(1L);
        verify(fileMetadataRepository, never()).findAll(any(Pageable.class));
    }

    // ── delete ──────────────────────────────────────────────────────────────────────────────

    /**
     * A second delete of an already-deleted file finds nothing (the finder excludes soft-deleted
     * rows) and must refuse. The consequence that matters is the quota: a delete that refunded on
     * every call would let a caller loop {@code DELETE} and drive their usage counter negative.
     */
    @Test
    void deletingAFileThatIsAlreadyGoneIsA404AndRefundsNothing() {
        when(fileMetadataRepository.findByIdAndDeletedAtIsNull(FILE_ID)).thenReturn(Optional.empty());

        Throwable thrown = catchThrowable(() -> service.delete(FILE_ID, TENANT));

        assertThat(thrown).isInstanceOf(ResponseStatusException.class);
        ResponseStatusException refusal = (ResponseStatusException) thrown;
        assertThat(refusal.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(refusal.getReason()).isEqualTo("File not found");
        verify(quotaService, never()).releaseQuota(any(UUID.class), anyLong());
        verify(fileMetadataRepository, never()).save(any(FileMetadataEntity.class));
    }

    /**
     * Delete is soft and the object is retained for compliance — so the one thing this must NOT do
     * is remove anything from MinIO, and the refund must be exactly the recorded size.
     */
    @Test
    void deleteStampsDeletedAtRefundsTheStoredSizeAndLeavesTheObjectInPlace() {
        FileMetadataEntity stored =
                meta("t/f/x.pdf", "x.pdf", "application/pdf", 4096L, "abc123");
        when(fileMetadataRepository.findByIdAndDeletedAtIsNull(FILE_ID))
                .thenReturn(Optional.of(stored));

        Instant before = Instant.now();
        service.delete(FILE_ID, TENANT);
        Instant after = Instant.now();

        assertThat(stored.getDeletedAt()).isNotNull().isBetween(before, after);
        verify(fileMetadataRepository).save(stored);
        verify(quotaService).releaseQuota(TENANT, 4096L);
        verifyNoInteractions(minioClient);
    }

    /**
     * The refund goes to the {@code tenantId} ARGUMENT, not to the tenant on the row that was
     * actually found. RLS is what stops the row from belonging to someone else, so in-process this
     * is safe today — but it means the counter a caller decrements is the one it names, and a
     * controller that ever passes a tenant other than the row's would credit the wrong tenant while
     * deleting this one's file. Pinned so that stays a deliberate choice rather than an accident.
     */
    @Test
    void deleteRefundsAgainstTheTenantArgumentNotTheTenantOnTheRow() {
        FileMetadataEntity stored =
                meta("t/f/x.pdf", "x.pdf", "application/pdf", 4096L, "abc123");
        assertThat(stored.getTenantId()).isEqualTo(TENANT);
        when(fileMetadataRepository.findByIdAndDeletedAtIsNull(FILE_ID))
                .thenReturn(Optional.of(stored));

        service.delete(FILE_ID, OTHER_TENANT);

        verify(quotaService).releaseQuota(OTHER_TENANT, 4096L);
        verify(quotaService, never()).releaseQuota(eq(TENANT), anyLong());
    }
}
