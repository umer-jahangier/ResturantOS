package io.restaurantos.file.controller;

import io.restaurantos.file.dto.FileDtos.FileUploadResponse;
import io.restaurantos.file.entity.FileMetadataEntity;
import io.restaurantos.file.exception.InvalidImageException;
import io.restaurantos.file.exception.QuotaExceededException;
import io.restaurantos.file.service.FileStorageService;
import io.restaurantos.file.service.ImageUploadPolicy;
import io.restaurantos.file.service.QuotaService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.InputStreamResource;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableHandlerMethodArgumentResolver;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayInputStream;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The wire contract of {@link FileController}, driven through a standalone MockMvc so that every
 * assertion is about what a caller RECEIVES rather than what a method returns.
 *
 * <h2>What this can and cannot prove</h2>
 *
 * <p>Standalone MockMvc runs the controller with Spring MVC's real argument resolution, message
 * conversion and exception-resolver chain, and no security filter chain. So the {@code @PreAuthorize}
 * codes ({@code file.view}, {@code file.upload}, {@code file.manage}) are NOT exercised here — a
 * green run of this class says nothing about whether KITCHEN_STAFF can still delete a file. That
 * claim needs a context with method security enabled and belongs to an endpoint-authorization IT.
 * Tenant isolation is likewise RLS and out of reach here; what IS in reach is that the controller
 * passes the tenant it was given and refuses before touching storage, which is asserted below.
 *
 * <p>The cases that carry weight are the refusals. Three of them exist because of a measured
 * production failure rather than a hypothetical:
 * <ul>
 *   <li>{@link #aRefusedImageIsA422CarryingThePolicysOwnSentence()} — this used to be
 *       {@code 500 INTERNAL_ERROR / "An unexpected error occurred"}. The upload was correctly
 *       refused and nothing was stored, but the user was told the server had crashed.</li>
 *   <li>{@link #anUploadIsStoredUnderTheSniffedTypeNotTheClientsDeclaredHeader()} — the stored
 *       content type is what {@code download()} later echoes to a browser, so a forged
 *       {@code image/png} must not survive into the record.</li>
 *   <li>{@link #quotaSumsEveryFileNotJustTheFirstPage()} — a paged read here would under-report
 *       usage and silently raise every tenant's effective limit.</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
class FileControllerTest {

    private static final UUID TENANT = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID USER = UUID.fromString("22222222-2222-2222-2222-222222222222");

    /** The policy's own words. Pinned as a literal because the user reads this verbatim. */
    private static final String NOT_AN_IMAGE =
            "That file is not a JPEG, PNG or WebP image. "
                    + "Renaming a file does not change what it is — re-export it as an image.";

    @Mock
    private FileStorageService fileStorageService;
    @Mock
    private QuotaService quotaService;
    @Mock
    private TenantContext tenantContext;
    @Mock
    private ImageUploadPolicy imageUploadPolicy;

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        FileController controller =
                new FileController(fileStorageService, quotaService, tenantContext, imageUploadPolicy);
        // @PageableDefault is resolved by Spring Data's resolver, which a standalone setup does
        // not register for us. Without it list() would not compile a Pageable at all.
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setCustomArgumentResolvers(new PageableHandlerMethodArgumentResolver())
                .build();
    }

    // ── upload ──────────────────────────────────────────────────────────────────────────────

    /**
     * The single most load-bearing assertion in this class: whatever the client CALLED the file,
     * the type handed to storage is the one the policy sniffed out of the bytes.
     */
    @Test
    void anUploadIsStoredUnderTheSniffedTypeNotTheClientsDeclaredHeader() throws Exception {
        UUID fileId = UUID.randomUUID();
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        when(tenantContext.getUserId()).thenReturn(Optional.of(USER));
        when(imageUploadPolicy.enforce(any(), eq(ImageUploadPolicy.MENU_ITEM_IMAGE)))
                .thenReturn("image/webp");
        when(fileStorageService.upload(any(), any(), any(), any()))
                .thenReturn(new FileUploadResponse(
                        fileId,
                        TENANT + "/" + fileId + "/dish.png",
                        "/api/v1/files/" + fileId + "/download",
                        1234L,
                        "image/webp",
                        "9f86d081"));

        mvc.perform(multipart("/api/v1/files")
                        // declared image/png, named .png — and neither is what gets stored
                        .file(new MockMultipartFile("file", "dish.png", "image/png", new byte[]{1, 2, 3}))
                        .param("purpose", ImageUploadPolicy.MENU_ITEM_IMAGE))
                .andExpect(status().isCreated())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.data.fileId").value(fileId.toString()))
                .andExpect(jsonPath("$.data.contentType").value("image/webp"))
                .andExpect(jsonPath("$.data.sizeBytes").value(1234))
                .andExpect(jsonPath("$.data.sha256").value("9f86d081"))
                .andExpect(jsonPath("$.data.downloadUrl")
                        .value("/api/v1/files/" + fileId + "/download"));

        ArgumentCaptor<UUID> tenant = ArgumentCaptor.forClass(UUID.class);
        ArgumentCaptor<UUID> uploader = ArgumentCaptor.forClass(UUID.class);
        ArgumentCaptor<String> storedType = ArgumentCaptor.forClass(String.class);
        verify(fileStorageService)
                .upload(any(), tenant.capture(), uploader.capture(), storedType.capture());

        assertThat(storedType.getValue())
                .as("the sniffed type must reach storage, not the client's declared image/png")
                .isEqualTo("image/webp");
        assertThat(tenant.getValue()).isEqualTo(TENANT);
        assertThat(uploader.getValue()).isEqualTo(USER);
    }

    /**
     * The opt-in boundary. Every pre-19b caller sends no {@code purpose}, and must keep behaving
     * exactly as before: the policy is still consulted (with a null purpose), returns null, and
     * storage is told to keep the client's own content type.
     */
    @Test
    void anUploadWithNoPurposeIsNotHeldToImageRulesAndEnforcesNoType() throws Exception {
        UUID fileId = UUID.randomUUID();
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        when(tenantContext.getUserId()).thenReturn(Optional.of(USER));
        when(fileStorageService.upload(any(), any(), any(), any()))
                .thenReturn(new FileUploadResponse(fileId, "key", "/url", 9L, "application/pdf", "aa"));

        mvc.perform(multipart("/api/v1/files")
                        .file(new MockMultipartFile("file", "invoice.pdf", "application/pdf", new byte[]{9})))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.contentType").value("application/pdf"));

        verify(imageUploadPolicy).enforce(any(), isNull());
        verify(fileStorageService).upload(any(), eq(TENANT), eq(USER), isNull());
    }

    /** An unrecognised purpose is not an image upload either — same pass-through, no 422. */
    @Test
    void anUnrecognisedPurposeIsNotHeldToImageRules() throws Exception {
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        when(tenantContext.getUserId()).thenReturn(Optional.of(USER));
        when(fileStorageService.upload(any(), any(), any(), any()))
                .thenReturn(new FileUploadResponse(UUID.randomUUID(), "k", "/u", 1L, "text/csv", "bb"));

        mvc.perform(multipart("/api/v1/files")
                        .file(new MockMultipartFile("file", "grn.csv", "text/csv", new byte[]{1}))
                        .param("purpose", "GRN_PHOTO"))
                .andExpect(status().isCreated());

        verify(imageUploadPolicy).enforce(any(), eq("GRN_PHOTO"));
        verify(fileStorageService).upload(any(), eq(TENANT), eq(USER), isNull());
    }

    /**
     * A token with a tenant but no {@code sub} still uploads; {@code uploadedBy} arrives as null
     * rather than blowing up on {@code Optional.get()}.
     */
    @Test
    void anUploadWithNoUserInContextPassesANullUploaderRatherThanFailing() throws Exception {
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        when(tenantContext.getUserId()).thenReturn(Optional.empty());
        when(fileStorageService.upload(any(), any(), any(), any()))
                .thenReturn(new FileUploadResponse(UUID.randomUUID(), "k", "/u", 1L, "text/plain", "cc"));

        mvc.perform(multipart("/api/v1/files")
                        .file(new MockMultipartFile("file", "n.txt", "text/plain", new byte[]{1})))
                .andExpect(status().isCreated());

        verify(fileStorageService).upload(any(), eq(TENANT), isNull(), isNull());
    }

    /**
     * 422, the policy's sentence verbatim, and — the half that actually protects storage — the
     * upload never reaches {@link FileStorageService}.
     */
    @Test
    void aRefusedImageIsA422CarryingThePolicysOwnSentence() throws Exception {
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        when(tenantContext.getUserId()).thenReturn(Optional.of(USER));
        when(imageUploadPolicy.enforce(any(), eq(ImageUploadPolicy.MENU_ITEM_IMAGE)))
                .thenThrow(new InvalidImageException(NOT_AN_IMAGE));

        mvc.perform(multipart("/api/v1/files")
                        .file(new MockMultipartFile("file", "dish.png", "image/png", "MZ".getBytes()))
                        .param("purpose", ImageUploadPolicy.MENU_ITEM_IMAGE))
                // 422 — the request is well formed, its CONTENT is not what it claims to be
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.error.code").value("INVALID_IMAGE"))
                .andExpect(jsonPath("$.error.message").value(NOT_AN_IMAGE))
                .andExpect(jsonPath("$.error.details").isEmpty());

        verify(fileStorageService, never()).upload(any(), any(), any(), any());
    }

    /**
     * Asserted separately from the 422, deliberately. The defect was that a specific, fixable
     * refusal was masked by a generic server error, so "is 422" and "is not a crash report" are
     * two different claims and only the second one regressed.
     */
    @Test
    void aRefusedImageIsNotA500SoTheUserLearnsWhatToFix() throws Exception {
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        when(tenantContext.getUserId()).thenReturn(Optional.of(USER));
        when(imageUploadPolicy.enforce(any(), eq(ImageUploadPolicy.MENU_ITEM_IMAGE)))
                .thenThrow(new InvalidImageException(NOT_AN_IMAGE));

        var response = mvc.perform(multipart("/api/v1/files")
                        .file(new MockMultipartFile("file", "dish.png", "image/png", new byte[]{4, 5}))
                        .param("purpose", ImageUploadPolicy.MENU_ITEM_IMAGE))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isNotEqualTo(500);
        assertThat(response.getContentAsString())
                .as("a fixable client problem must not be reported as the server crashing")
                .doesNotContain("INTERNAL_ERROR")
                .doesNotContain("An unexpected error occurred");
    }

    /**
     * 409 with a machine-readable warning code, and no {@code data}. The tenant needs the numbers
     * to know how much to delete, so the exception's own message is what ships.
     */
    @Test
    void anUploadOverQuotaIsA409WithTheUsedAndLimitNumbers() throws Exception {
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        when(tenantContext.getUserId()).thenReturn(Optional.of(USER));
        when(fileStorageService.upload(any(), any(), any(), any()))
                .thenThrow(new QuotaExceededException("STORAGE_GB", 5_242_880L, 5_242_880L));

        mvc.perform(multipart("/api/v1/files")
                        .file(new MockMultipartFile("file", "big.bin", "application/octet-stream", new byte[]{1})))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.warnings[0].code").value("QUOTA_EXCEEDED"))
                .andExpect(jsonPath("$.warnings[0].message", containsString("STORAGE_GB")))
                .andExpect(jsonPath("$.warnings[0].message", containsString("used=5242880")))
                .andExpect(jsonPath("$.warnings[0].message", containsString("limit=5242880")))
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    /** A multipart POST with no {@code file} part is refused by MVC before anything is touched. */
    @Test
    void anUploadWithNoFilePartIsRefusedBeforeTheTenantIsEvenResolved() throws Exception {
        mvc.perform(multipart("/api/v1/files").param("purpose", ImageUploadPolicy.MENU_ITEM_IMAGE))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(fileStorageService, imageUploadPolicy, tenantContext);
    }

    /**
     * Ordering guarantee: the tenant is resolved FIRST. If it cannot be, neither the policy nor
     * MinIO is reached, so a tenantless request can never write a byte.
     */
    @Test
    void anUploadWithNoTenantNeverReachesThePolicyOrStorage() {
        when(tenantContext.requireTenantId())
                .thenThrow(new IllegalStateException("No tenant in context"));

        assertThatThrownBy(() -> mvc.perform(multipart("/api/v1/files")
                .file(new MockMultipartFile("file", "n.txt", "text/plain", new byte[]{1}))))
                .hasStackTraceContaining("No tenant in context");

        verifyNoInteractions(fileStorageService, imageUploadPolicy);
    }

    // ── list ────────────────────────────────────────────────────────────────────────────────

    /**
     * The download URL is built here, from the id, and is the only way a caller can fetch bytes —
     * so a wrong shape breaks every listing in the UI silently.
     */
    @Test
    void listMapsEachRowToItsDownloadUrlAndReportsTheNextCursor() throws Exception {
        UUID id = UUID.randomUUID();
        when(fileStorageService.listFiles(any(Pageable.class)))
                .thenReturn(new PageImpl<>(
                        List.of(entity(id, "invoice scan.pdf", "application/pdf", 2048L, "deadbeef")),
                        PageRequest.of(0, 20), 45L));

        mvc.perform(get("/api/v1/files"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].fileId").value(id.toString()))
                .andExpect(jsonPath("$.data[0].originalFilename").value("invoice scan.pdf"))
                .andExpect(jsonPath("$.data[0].contentType").value("application/pdf"))
                .andExpect(jsonPath("$.data[0].sizeBytes").value(2048))
                .andExpect(jsonPath("$.data[0].sha256").value("deadbeef"))
                .andExpect(jsonPath("$.data[0].downloadUrl")
                        .value("/api/v1/files/" + id + "/download"))
                .andExpect(jsonPath("$.data[0].createdAt").exists())
                .andExpect(jsonPath("$.meta.page.cursor").value("0"))
                .andExpect(jsonPath("$.meta.page.nextCursor").value("1"))
                .andExpect(jsonPath("$.meta.page.limit").value(20))
                .andExpect(jsonPath("$.meta.totalCount").value(45));

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(fileStorageService).listFiles(pageable.capture());
        assertThat(pageable.getValue().getPageNumber()).isZero();
        assertThat(pageable.getValue().getPageSize())
                .as("@PageableDefault(size = 20) is the contract for a caller that sends nothing")
                .isEqualTo(20);
    }

    /**
     * The boundary that a paginating client actually depends on: on the LAST page there must be
     * no next cursor, or the client loops forever asking for a page that does not exist.
     */
    @Test
    void theLastPageOffersNoNextCursorAndHonoursTheRequestedSize() throws Exception {
        when(fileStorageService.listFiles(any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.<FileMetadataEntity>of(), PageRequest.of(2, 5), 15L));

        mvc.perform(get("/api/v1/files").param("page", "2").param("size", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data").isEmpty())
                .andExpect(jsonPath("$.meta.page.cursor").value("2"))
                .andExpect(jsonPath("$.meta.page.nextCursor").doesNotExist())
                .andExpect(jsonPath("$.meta.page.limit").value(5))
                .andExpect(jsonPath("$.meta.totalCount").value(15));

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(fileStorageService).listFiles(pageable.capture());
        assertThat(pageable.getValue().getPageNumber()).isEqualTo(2);
        assertThat(pageable.getValue().getPageSize())
                .as("a requested size must not be silently replaced by the default")
                .isEqualTo(5);
    }

    // ── download ────────────────────────────────────────────────────────────────────────────

    /**
     * The controller must hand the service's response back untouched. Rewriting the Content-Type
     * here would undo the point of storing a sniffed type in the first place.
     */
    @Test
    void downloadPassesTheStoredTypeDispositionAndBytesThroughUnchanged() throws Exception {
        UUID id = UUID.randomUUID();
        byte[] bytes = {(byte) 0x89, 'P', 'N', 'G', 0x0D};
        when(fileStorageService.download(id)).thenReturn(ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .contentLength(bytes.length)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"dish.png\"")
                .body(new InputStreamResource(new ByteArrayInputStream(bytes))));

        mvc.perform(get("/api/v1/files/{id}/download", id))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.IMAGE_PNG))
                .andExpect(content().bytes(bytes))
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"dish.png\""));
    }

    /**
     * A file belonging to another tenant is filtered out by RLS, so the repository sees nothing
     * and the service raises 404. The caller must not be able to tell "wrong tenant" from
     * "no such file" — that difference is an existence oracle across tenants.
     */
    @Test
    void downloadingAFileOutsideTheTenantIsIndistinguishableFromItNotExisting() throws Exception {
        UUID id = UUID.randomUUID();
        when(fileStorageService.download(id))
                .thenThrow(new ResponseStatusException(HttpStatus.NOT_FOUND, "File not found"));

        mvc.perform(get("/api/v1/files/{id}/download", id))
                .andExpect(status().isNotFound());
    }

    /** A path variable that is not a UUID is the client's error, and storage is never consulted. */
    @Test
    void aMalformedFileIdIsRefusedWithoutTouchingStorage() throws Exception {
        mvc.perform(get("/api/v1/files/{id}/download", "not-a-uuid"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(fileStorageService);
    }

    // ── delete ──────────────────────────────────────────────────────────────────────────────

    /**
     * Delete is the only irreversible operation of the five. The tenant it is scoped to must come
     * from {@link TenantContext} and nowhere else — never from anything in the request.
     */
    @Test
    void deleteIsScopedToTheTenantFromContextNotFromTheRequest() throws Exception {
        UUID id = UUID.randomUUID();
        when(tenantContext.requireTenantId()).thenReturn(TENANT);

        mvc.perform(delete("/api/v1/files/{id}", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").doesNotExist())
                .andExpect(jsonPath("$.warnings").isEmpty());

        ArgumentCaptor<UUID> fileId = ArgumentCaptor.forClass(UUID.class);
        ArgumentCaptor<UUID> tenant = ArgumentCaptor.forClass(UUID.class);
        verify(fileStorageService).delete(fileId.capture(), tenant.capture());
        assertThat(fileId.getValue()).isEqualTo(id);
        assertThat(tenant.getValue()).isEqualTo(TENANT);
    }

    /** Deleting something already gone, or belonging to someone else, is a 404 — not a 500. */
    @Test
    void deletingAMissingOrForeignFileIsA404() throws Exception {
        UUID id = UUID.randomUUID();
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        doThrow(new ResponseStatusException(HttpStatus.NOT_FOUND, "File not found"))
                .when(fileStorageService).delete(any(UUID.class), any(UUID.class));

        mvc.perform(delete("/api/v1/files/{id}", id))
                .andExpect(status().isNotFound());
    }

    // ── quota ───────────────────────────────────────────────────────────────────────────────

    /**
     * Usage is the sum over EVERY file, which is why the read is unpaged. A default-paged read
     * would stop at 20 rows and quietly report a fraction of real usage — raising every tenant's
     * effective limit without anyone noticing.
     */
    @Test
    void quotaSumsEveryFileNotJustTheFirstPage() throws Exception {
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        when(quotaService.getStorageLimitBytes(TENANT)).thenReturn(4096L);
        when(fileStorageService.listFiles(any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(sized(1024L), sized(2048L))));

        mvc.perform(get("/api/v1/files/quota"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.usedBytes").value(3072))
                .andExpect(jsonPath("$.data.limitBytes").value(4096))
                .andExpect(jsonPath("$.data.usedPercent").value(75.0));

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(fileStorageService).listFiles(pageable.capture());
        assertThat(pageable.getValue().isUnpaged())
                .as("a paged read here under-reports usage and silently raises the limit")
                .isTrue();
    }

    /**
     * The divide-by-zero guard. A tier that resolves to a zero limit must report 0% rather than
     * NaN or Infinity — both of which serialize badly and render as nonsense in a progress bar.
     */
    @Test
    void aZeroLimitReportsZeroPercentRatherThanDividingByZero() throws Exception {
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        when(quotaService.getStorageLimitBytes(TENANT)).thenReturn(0L);
        when(fileStorageService.listFiles(any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(sized(500L))));

        mvc.perform(get("/api/v1/files/quota"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.usedBytes").value(500))
                .andExpect(jsonPath("$.data.limitBytes").value(0))
                .andExpect(jsonPath("$.data.usedPercent").value(0.0));
    }

    /** Exactly full is 100%, not 99-point-something and not over. */
    @Test
    void usageExactlyAtTheLimitIsReportedAsOneHundredPercent() throws Exception {
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        when(quotaService.getStorageLimitBytes(TENANT)).thenReturn(2048L);
        when(fileStorageService.listFiles(any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(sized(1024L), sized(1024L))));

        mvc.perform(get("/api/v1/files/quota"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.usedBytes").value(2048))
                .andExpect(jsonPath("$.data.usedPercent").value(100.0));
    }

    /** A tenant that has uploaded nothing is 0 of N, not an empty or absent envelope. */
    @Test
    void aTenantWithNoFilesReportsZeroUsedAgainstItsRealLimit() throws Exception {
        when(tenantContext.requireTenantId()).thenReturn(TENANT);
        when(quotaService.getStorageLimitBytes(TENANT)).thenReturn(5_242_880L);
        when(fileStorageService.listFiles(any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.<FileMetadataEntity>of()));

        mvc.perform(get("/api/v1/files/quota"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.usedBytes").value(0))
                .andExpect(jsonPath("$.data.limitBytes").value(5242880))
                .andExpect(jsonPath("$.data.usedPercent").value(0.0));
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────

    private static FileMetadataEntity entity(UUID id, String filename, String contentType,
                                             long sizeBytes, String sha256) {
        FileMetadataEntity e = new FileMetadataEntity();
        e.setId(id);
        e.setTenantId(TENANT);
        e.setUploadedBy(USER);
        e.setObjectKey(TENANT + "/" + id + "/" + filename);
        e.setOriginalFilename(filename);
        e.setContentType(contentType);
        e.setSizeBytes(sizeBytes);
        e.setSha256(sha256);
        e.setCreatedAt(Instant.parse("2026-01-15T10:30:00Z"));
        return e;
    }

    /** Only {@code sizeBytes} matters to the quota sum; the rest is filler. */
    private static FileMetadataEntity sized(long sizeBytes) {
        return entity(UUID.randomUUID(), "f.bin", "application/octet-stream", sizeBytes, "00");
    }
}
