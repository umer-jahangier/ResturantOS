package io.restaurantos.file.controller;

import io.restaurantos.file.entity.FileMetadataEntity;
import io.restaurantos.file.repository.FileMetadataRepository;
import io.restaurantos.file.service.FileStorageService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The {@code /internal/**} seam has no user principal and no JWT: the tenant arrives as a header
 * that the CALLING SERVICE chooses. Every refusal in this controller rests on that header alone,
 * so most of what follows is one question asked three ways — does a caller naming a tenant it does
 * not own learn anything at all?
 *
 * <h2>Why the mocks model the query instead of returning a fixed value</h2>
 *
 * <p>{@link #stubTenantScopedLookup} and {@link #stubTenantScopedContent} hand back the row ONLY
 * when the tenant argument matches its owner, mirroring what the tenant-named JPQL does. A mock
 * that returned the entity regardless of the tenant argument would let every cross-tenant test
 * below pass while proving nothing — the controller could drop the tenant from the call entirely
 * and the suite would stay green. That is the precise defect this file is written to exclude.
 *
 * <p>Plain standalone MockMvc: no Spring context, no database, no MinIO. The two things that
 * therefore CANNOT be asserted here are noted at
 * {@link #theInternalReadIsBoundedAtEightMebibytes()} and
 * {@link #anUnreadableFileIsAPlain404()} — the 8 MiB ceiling and soft-delete filtering are both
 * enforced below this class, so all the controller owns of them is the argument it passes and the
 * status it maps an empty result to.
 */
@ExtendWith(MockitoExtension.class)
class InternalFileControllerTest {

    private static final String TENANT_HEADER = "X-Tenant-Id";
    private static final String SHA_HEADER = "X-Content-Sha256";

    /** The tenant that actually owns FILE_ID. */
    private static final UUID OWNER_TENANT = UUID.fromString("11111111-1111-1111-1111-111111111111");
    /** A different, equally real tenant whose service is asking about someone else's file. */
    private static final UUID OTHER_TENANT = UUID.fromString("22222222-2222-2222-2222-222222222222");

    private static final UUID FILE_ID = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID UNKNOWN_FILE_ID = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    private static final String SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    private static final byte[] PNG_BYTES = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};

    /** The controller documents 8 MiB. Spelled out here so a silent change to the field fails. */
    private static final long EXPECTED_CEILING_BYTES = 8L * 1024 * 1024;

    @Mock
    private FileMetadataRepository fileMetadataRepository;
    @Mock
    private FileStorageService fileStorageService;
    @Mock
    private TenantContext tenantContext;

    private InternalFileController controller;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        controller = new InternalFileController(fileMetadataRepository, fileStorageService, tenantContext);
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────

    private static FileMetadataEntity ownedFile(String filename, String contentType, long sizeBytes, String sha256) {
        FileMetadataEntity meta = new FileMetadataEntity();
        meta.setId(FILE_ID);
        meta.setTenantId(OWNER_TENANT);
        meta.setUploadedBy(UUID.fromString("33333333-3333-3333-3333-333333333333"));
        meta.setObjectKey(OWNER_TENANT + "/" + FILE_ID + "/" + filename);
        meta.setOriginalFilename(filename);
        meta.setContentType(contentType);
        meta.setSizeBytes(sizeBytes);
        meta.setSha256(sha256);
        meta.setCreatedAt(Instant.parse("2026-02-01T10:15:30Z"));
        return meta;
    }

    private static FileMetadataEntity aMenuImage() {
        return ownedFile("margherita.png", "image/png", 524288L, SHA);
    }

    /**
     * Models {@code FileMetadataRepository#findByIdAndTenantId}: the row comes back only for the
     * tenant that owns it, so "unknown id" and "someone else's id" collapse to the same empty
     * Optional exactly as the JPQL does.
     */
    private void stubTenantScopedLookup(FileMetadataEntity owned) {
        when(fileMetadataRepository.findByIdAndTenantId(any(), any())).thenAnswer(invocation -> {
            UUID askedId = invocation.getArgument(0);
            UUID askedTenant = invocation.getArgument(1);
            if (FILE_ID.equals(askedId) && OWNER_TENANT.equals(askedTenant)) {
                return Optional.of(owned);
            }
            return Optional.empty();
        });
    }

    /** Same shape one layer down: bytes only for the owning tenant. */
    private void stubTenantScopedContent(FileStorageService.FileContent stored) {
        when(fileStorageService.readForTenant(any(), any(), anyLong())).thenAnswer(invocation -> {
            UUID askedId = invocation.getArgument(0);
            UUID askedTenant = invocation.getArgument(1);
            if (FILE_ID.equals(askedId) && OWNER_TENANT.equals(askedTenant)) {
                return Optional.of(stored);
            }
            return Optional.empty();
        });
    }

    // ══ GET /internal/files/{id} — metadata ═════════════════════════════════════════════════

    @Test
    @DisplayName("metadata: a file in the caller's own tenant resolves, with the public download path")
    void metadataForTheOwningTenantIsReturned() throws Exception {
        stubTenantScopedLookup(aMenuImage());

        mockMvc.perform(get("/internal/files/{id}", FILE_ID)
                        .header(TENANT_HEADER, OWNER_TENANT.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.fileId").value(FILE_ID.toString()))
                .andExpect(jsonPath("$.data.originalFilename").value("margherita.png"))
                .andExpect(jsonPath("$.data.contentType").value("image/png"))
                .andExpect(jsonPath("$.data.sizeBytes").value(524288))
                .andExpect(jsonPath("$.data.sha256").value(SHA))
                // pos-service persists this string. If it ever stops matching the public download
                // route, the menu renders a broken image and nothing anywhere reports an error.
                .andExpect(jsonPath("$.data.downloadUrl")
                        .value("/api/v1/files/" + FILE_ID + "/download"))
                .andExpect(jsonPath("$.data.createdAt").exists());
    }

    @Test
    @DisplayName("metadata: another tenant's file is a 404 with an empty body — not a 403, not the filename")
    void aFileOwnedByAnotherTenantIsNotDescribed() throws Exception {
        stubTenantScopedLookup(ownedFile("payroll-scan.pdf", "application/pdf", 91234L, SHA));

        MockHttpServletResponse response = mockMvc.perform(get("/internal/files/{id}", FILE_ID)
                        .header(TENANT_HEADER, OTHER_TENANT.toString()))
                .andExpect(status().isNotFound())
                .andReturn().getResponse();

        // A 403 would confirm the id exists somewhere — the probe this endpoint documents itself
        // as refusing to answer.
        assertThat(response.getStatus()).isNotEqualTo(HttpStatus.FORBIDDEN.value());
        String body = response.getContentAsString();
        assertThat(body).doesNotContain("payroll-scan.pdf");
        assertThat(body).isEmpty();
    }

    @Test
    @DisplayName("metadata: an unknown id and another tenant's id answer byte-for-byte identically")
    void unknownAndWrongTenantAnswerIdentically() throws Exception {
        stubTenantScopedLookup(aMenuImage());

        MockHttpServletResponse wrongTenant = mockMvc.perform(get("/internal/files/{id}", FILE_ID)
                        .header(TENANT_HEADER, OTHER_TENANT.toString()))
                .andReturn().getResponse();
        MockHttpServletResponse unknownFile = mockMvc.perform(get("/internal/files/{id}", UNKNOWN_FILE_ID)
                        .header(TENANT_HEADER, OWNER_TENANT.toString()))
                .andReturn().getResponse();

        assertThat(wrongTenant.getStatus()).isEqualTo(HttpStatus.NOT_FOUND.value());
        assertThat(unknownFile.getStatus()).isEqualTo(wrongTenant.getStatus());
        assertThat(unknownFile.getContentAsString())
                .isEqualTo(wrongTenant.getContentAsString())
                .isEmpty();
    }

    @Test
    @DisplayName("metadata: the 404 is RETURNED, not thrown — a miss must not read as a server fault")
    void theMissTravelsAsAStatusNotAnException() {
        stubTenantScopedLookup(aMenuImage());

        // Regression guard for the bug named in the controller's javadoc: throwing
        // ResponseStatusException here fell through shared-lib's catch-all as a 500
        // "An unexpected error occurred". Asserted against the method's own return value so the
        // claim is about this controller's contract, not about which resolver MockMvc installs.
        assertThat(controller.getMetadata(OTHER_TENANT, FILE_ID).getStatusCode().value())
                .isEqualTo(HttpStatus.NOT_FOUND.value());
    }

    @Test
    @DisplayName("metadata: the tenant GUC is set from the header BEFORE the query and cleared after it")
    void tenantContextIsSetFromTheHeaderAndAlwaysCleared() throws Exception {
        stubTenantScopedLookup(aMenuImage());

        mockMvc.perform(get("/internal/files/{id}", FILE_ID)
                        .header(TENANT_HEADER, OWNER_TENANT.toString()))
                .andExpect(status().isOk());

        // Order is the whole point: RLS is driven at connection checkout, so a set() after the
        // query leaves the read unscoped, and a missing clear() leaks this tenant onto whatever
        // request reuses the thread next.
        InOrder ordered = inOrder(tenantContext, fileMetadataRepository);
        ordered.verify(tenantContext).set(OWNER_TENANT, null, null, null);
        ordered.verify(fileMetadataRepository).findByIdAndTenantId(FILE_ID, OWNER_TENANT);
        ordered.verify(tenantContext).clear();
    }

    @Test
    @DisplayName("metadata: a cross-tenant lookup drives the GUC with the CALLER's tenant, never the row's")
    void tenantContextFollowsTheCallerNotTheRow() throws Exception {
        stubTenantScopedLookup(aMenuImage());

        mockMvc.perform(get("/internal/files/{id}", FILE_ID)
                        .header(TENANT_HEADER, OTHER_TENANT.toString()))
                .andExpect(status().isNotFound());

        verify(tenantContext).set(OTHER_TENANT, null, null, null);
        verify(tenantContext, never()).set(OWNER_TENANT, null, null, null);
        verify(tenantContext).clear();
    }

    @Test
    @DisplayName("metadata: the ThreadLocal is cleared even when the lookup blows up")
    void tenantContextIsClearedWhenTheRepositoryThrows() {
        when(fileMetadataRepository.findByIdAndTenantId(FILE_ID, OWNER_TENANT))
                .thenThrow(new IllegalStateException("connection pool exhausted"));

        assertThatThrownBy(() -> controller.getMetadata(OWNER_TENANT, FILE_ID))
                .isInstanceOf(IllegalStateException.class);

        // Without the finally block, the next request on this thread inherits OWNER_TENANT.
        verify(tenantContext).clear();
    }

    @Test
    @DisplayName("metadata: no X-Tenant-Id — refused before the database or the ThreadLocal is touched")
    void aRequestWithoutTheTenantHeaderIsRefused() throws Exception {
        mockMvc.perform(get("/internal/files/{id}", FILE_ID))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(fileMetadataRepository, fileStorageService, tenantContext);
    }

    // ══ GET /internal/files/{id}/content — bytes ════════════════════════════════════════════

    @Test
    @DisplayName("content: bytes come back under the STORED content type, with the digest header")
    void contentIsServedWithItsStoredTypeAndDigest() throws Exception {
        stubTenantScopedContent(new FileStorageService.FileContent(PNG_BYTES, "image/png", SHA));

        mockMvc.perform(get("/internal/files/{id}/content", FILE_ID)
                        .header(TENANT_HEADER, OWNER_TENANT.toString()))
                .andExpect(status().isOk())
                .andExpect(content().contentType("image/png"))
                .andExpect(header().string(SHA_HEADER, SHA))
                .andExpect(content().bytes(PNG_BYTES));

        // The same set/query/clear ordering the metadata path is held to. Asserted separately
        // here because it is enforced separately: readForTenant runs its own query under FORCE
        // RLS, where a missing GUC yields zero rows rather than an error — so dropping the set()
        // from THIS method turns every internal image fetch into a 404 that is indistinguishable
        // from a correct cross-tenant refusal. Without these three lines that regression is
        // invisible: the tenant-scoped stub answers the same either way.
        InOrder ordered = inOrder(tenantContext, fileStorageService);
        ordered.verify(tenantContext).set(OWNER_TENANT, null, null, null);
        ordered.verify(fileStorageService).readForTenant(FILE_ID, OWNER_TENANT, EXPECTED_CEILING_BYTES);
        ordered.verify(tenantContext).clear();
    }

    @Test
    @DisplayName("content: a file stored before digests existed sends an empty header, never the text \"null\"")
    void aMissingDigestBecomesAnEmptyHeader() throws Exception {
        stubTenantScopedContent(new FileStorageService.FileContent(PNG_BYTES, "image/webp", null));

        mockMvc.perform(get("/internal/files/{id}/content", FILE_ID)
                        .header(TENANT_HEADER, OWNER_TENANT.toString()))
                .andExpect(status().isOk())
                // A caller keying its cache on this header would otherwise file every digest-less
                // file in the estate under one key, "null", and serve them as each other.
                .andExpect(header().string(SHA_HEADER, ""))
                .andExpect(content().contentType("image/webp"))
                .andExpect(content().bytes(PNG_BYTES));
    }

    @Test
    @DisplayName("content: another tenant's bytes are refused — no body, no content type, no digest")
    void anotherTenantsBytesAreRefused() throws Exception {
        stubTenantScopedContent(new FileStorageService.FileContent(PNG_BYTES, "image/png", SHA));

        MockHttpServletResponse response = mockMvc.perform(
                        get("/internal/files/{id}/content", FILE_ID)
                                .header(TENANT_HEADER, OTHER_TENANT.toString()))
                .andExpect(status().isNotFound())
                .andReturn().getResponse();

        assertThat(response.getStatus()).isNotEqualTo(HttpStatus.FORBIDDEN.value());
        assertThat(response.getContentAsByteArray()).isEmpty();
        // The digest alone is enough to confirm a file's existence and identity to a caller that
        // already holds the bytes, so it must not survive the refusal either. Nor may the stored
        // content type, which would leak that the id names a PDF rather than an image.
        assertThat(response.getHeader(SHA_HEADER)).isNull();
        assertThat(response.getContentType()).isNull();

        // As on the metadata path: the GUC follows the CALLER's tenant, never the row's.
        verify(tenantContext).set(OTHER_TENANT, null, null, null);
        verify(tenantContext, never()).set(OWNER_TENANT, null, null, null);
        verify(tenantContext).clear();
    }

    @Test
    @DisplayName("content: an empty read — missing, soft-deleted or over the ceiling — is the same 404")
    void anUnreadableFileIsAPlain404() throws Exception {
        // Which of the three it was is decided inside FileStorageService (needs MinIO + Postgres,
        // so not exercised here). What is asserted is the controller's half of the contract: an
        // empty Optional becomes a bodiless 404 and nothing else.
        stubTenantScopedContent(new FileStorageService.FileContent(PNG_BYTES, "image/png", SHA));

        mockMvc.perform(get("/internal/files/{id}/content", UNKNOWN_FILE_ID)
                        .header(TENANT_HEADER, OWNER_TENANT.toString()))
                .andExpect(status().isNotFound())
                .andExpect(content().string(""));
    }

    @Test
    @DisplayName("content: the read is bounded at 8 MiB and scoped to the header's tenant and the path's id")
    void theInternalReadIsBoundedAtEightMebibytes() throws Exception {
        // The ceiling is ENFORCED in FileStorageService; what the controller owns is the number it
        // passes and the ORDER it passes it in. readForTenant(fileId, tenantId, maxBytes) takes two
        // UUIDs in a row, so a transposed pair compiles cleanly and reads across tenants in silence.
        when(fileStorageService.readForTenant(any(), any(), anyLong()))
                .thenReturn(Optional.of(new FileStorageService.FileContent(PNG_BYTES, "image/png", SHA)));

        mockMvc.perform(get("/internal/files/{id}/content", FILE_ID)
                        .header(TENANT_HEADER, OWNER_TENANT.toString()))
                .andExpect(status().isOk());

        ArgumentCaptor<UUID> fileIdCaptor = ArgumentCaptor.forClass(UUID.class);
        ArgumentCaptor<UUID> tenantCaptor = ArgumentCaptor.forClass(UUID.class);
        ArgumentCaptor<Long> maxBytesCaptor = ArgumentCaptor.forClass(Long.class);
        verify(fileStorageService).readForTenant(
                fileIdCaptor.capture(), tenantCaptor.capture(), maxBytesCaptor.capture());

        assertThat(fileIdCaptor.getValue()).isEqualTo(FILE_ID);
        assertThat(tenantCaptor.getValue()).isEqualTo(OWNER_TENANT);
        assertThat(maxBytesCaptor.getValue()).isEqualTo(EXPECTED_CEILING_BYTES);
        assertThat(InternalFileController.MAX_INTERNAL_CONTENT_BYTES).isEqualTo(EXPECTED_CEILING_BYTES);
    }

    @Test
    @DisplayName("content: the ThreadLocal is cleared even when the storage read blows up")
    void tenantContextIsClearedWhenStorageThrows() {
        when(fileStorageService.readForTenant(FILE_ID, OWNER_TENANT, EXPECTED_CEILING_BYTES))
                .thenThrow(new RuntimeException("File read from storage failed: connection reset"));

        assertThatThrownBy(() -> controller.getContent(OWNER_TENANT, FILE_ID))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("storage");

        verify(tenantContext).clear();
    }

    @Test
    @DisplayName("content: no X-Tenant-Id — refused before a single byte is read")
    void aContentRequestWithoutTheTenantHeaderIsRefused() throws Exception {
        mockMvc.perform(get("/internal/files/{id}/content", FILE_ID))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(fileMetadataRepository, fileStorageService, tenantContext);
    }

    // ══ DELETE /internal/files/{id} — release ═══════════════════════════════════════════════

    @Test
    @DisplayName("release: a file the caller's tenant owns is soft-deleted in that tenant")
    void anOwnedFileIsReleased() throws Exception {
        stubTenantScopedLookup(aMenuImage());

        mockMvc.perform(delete("/internal/files/{id}", FILE_ID)
                        .header(TENANT_HEADER, OWNER_TENANT.toString()))
                .andExpect(status().isNoContent());

        ArgumentCaptor<UUID> fileIdCaptor = ArgumentCaptor.forClass(UUID.class);
        ArgumentCaptor<UUID> tenantCaptor = ArgumentCaptor.forClass(UUID.class);
        verify(fileStorageService).delete(fileIdCaptor.capture(), tenantCaptor.capture());
        assertThat(fileIdCaptor.getValue()).isEqualTo(FILE_ID);
        assertThat(tenantCaptor.getValue()).isEqualTo(OWNER_TENANT);

        // Third endpoint, third independent set/clear pair — and the one with the most to lose,
        // since FileStorageService.delete resolves the row through an RLS-only query. Drop the
        // set() here and the ownership check above still passes, then the delete finds nothing
        // and the failure is swallowed into the same 204 a successful release returns.
        InOrder ordered = inOrder(tenantContext, fileMetadataRepository, fileStorageService);
        ordered.verify(tenantContext).set(OWNER_TENANT, null, null, null);
        ordered.verify(fileMetadataRepository).findByIdAndTenantId(FILE_ID, OWNER_TENANT);
        ordered.verify(fileStorageService).delete(FILE_ID, OWNER_TENANT);
        ordered.verify(tenantContext).clear();
    }

    @Test
    @DisplayName("release: a tenant cannot release a file it does not own — storage is never touched")
    void anotherTenantsFileIsNotDeleted() throws Exception {
        stubTenantScopedLookup(aMenuImage());

        // The 204 is by contract (release is idempotent), so the status proves nothing on its own —
        // the verify below is the assertion. Drop the ownership check in the controller and any
        // service holding a stolen UUID can delete another tenant's file behind an identical 204.
        mockMvc.perform(delete("/internal/files/{id}", FILE_ID)
                        .header(TENANT_HEADER, OTHER_TENANT.toString()))
                .andExpect(status().isNoContent());

        verify(fileStorageService, never()).delete(any(), any());
        verify(tenantContext).set(OTHER_TENANT, null, null, null);
        verify(tenantContext, never()).set(OWNER_TENANT, null, null, null);
    }

    @Test
    @DisplayName("release: an id that is already gone is 204, and stays 204 on retry")
    void releaseIsIdempotent() throws Exception {
        stubTenantScopedLookup(aMenuImage());

        mockMvc.perform(delete("/internal/files/{id}", UNKNOWN_FILE_ID)
                        .header(TENANT_HEADER, OWNER_TENANT.toString()))
                .andExpect(status().isNoContent());
        mockMvc.perform(delete("/internal/files/{id}", UNKNOWN_FILE_ID)
                        .header(TENANT_HEADER, OWNER_TENANT.toString()))
                .andExpect(status().isNoContent());

        verify(fileStorageService, never()).delete(any(), any());
    }

    @Test
    @DisplayName("release: a storage failure is swallowed — a menu save must not fail on its cleanup")
    void aStorageFailureIsSwallowed() throws Exception {
        stubTenantScopedLookup(aMenuImage());
        // The real race: the row is there at the check and gone by the delete, which is exactly
        // what FileStorageService.delete raises.
        doThrow(new ResponseStatusException(HttpStatus.NOT_FOUND, "File not found"))
                .when(fileStorageService).delete(FILE_ID, OWNER_TENANT);

        mockMvc.perform(delete("/internal/files/{id}", FILE_ID)
                        .header(TENANT_HEADER, OWNER_TENANT.toString()))
                .andExpect(status().isNoContent())
                .andExpect(content().string(""));

        verify(tenantContext).clear();
    }

    @Test
    @DisplayName("release: a database failure is swallowed too, and the ThreadLocal still clears")
    void aRepositoryFailureIsSwallowed() throws Exception {
        when(fileMetadataRepository.findByIdAndTenantId(FILE_ID, OWNER_TENANT))
                .thenThrow(new IllegalStateException("connection pool exhausted"));

        mockMvc.perform(delete("/internal/files/{id}", FILE_ID)
                        .header(TENANT_HEADER, OWNER_TENANT.toString()))
                .andExpect(status().isNoContent());

        verify(fileStorageService, never()).delete(any(), any());
        verify(tenantContext).clear();
    }

    @Test
    @DisplayName("release: no X-Tenant-Id — refused before anything is deleted")
    void aReleaseWithoutTheTenantHeaderIsRefused() throws Exception {
        mockMvc.perform(delete("/internal/files/{id}", FILE_ID))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(fileMetadataRepository, fileStorageService, tenantContext);
    }
}
