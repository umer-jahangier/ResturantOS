package io.restaurantos.shared.event;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The audit allow-list and the services that publish events agree about what exists.
 *
 * <p>This is {@code PermissionCatalogClosureTest} applied to a second vocabulary that had drifted
 * exactly as badly and for exactly as long. Measured on 2026-08-07: <b>four of the eight</b>
 * allow-listed event types were published by no service anywhere in the repository.
 *
 * <table>
 *   <tr><th>Allow-listed</th><th>Actually published</th></tr>
 *   <tr><td>{@code VOID_CREATED}</td><td>{@code ORDER_VOIDED} (pos-service)</td></tr>
 *   <tr><td>{@code REFUND_CREATED}</td><td>{@code ORDER_REFUNDED} (pos-service)</td></tr>
 *   <tr><td>{@code RBAC_CHANGED}</td><td>nothing — no role-change event existed</td></tr>
 *   <tr><td>{@code IMPERSONATION_STARTED}</td><td>nothing — only a platform-local table</td></tr>
 * </table>
 *
 * <p>So voids and refunds — the two operations an auditor looks at first, and the two that move
 * money out of the till — were unaudited because of a two-word string mismatch, and role changes
 * were unaudited because the event the list was waiting for had never been written.
 *
 * <p><b>No ordinary test could have failed on this.</b> An allow-list entry nobody publishes throws
 * nothing, breaks no unit test, and produces no error at runtime: ingestion runs, matches no event,
 * writes no row, logs nothing above DEBUG. The system behaves precisely as it would if those
 * operations had simply never happened. The only way to catch it is to compare the two vocabularies
 * directly, which is what this does — over the repository tree rather than a running system, so it
 * fails on the branch that introduces the drift.
 *
 * <p>Two directions, and both matter:
 *
 * <ol>
 *   <li>Every type in {@link AuditEventCatalog#MUST_AUDIT} has a publisher. Catches the defect
 *       above — an allow-list waiting for an event that will never arrive.</li>
 *   <li>Every published type that looks security- or money-relevant is classified, as either
 *       must-audit or explicitly not-audit-relevant. Catches the opposite defect: a new
 *       {@code DISCOUNT_OVERRIDDEN} or {@code ROLE_ESCALATED} shipping with no audit coverage
 *       because nobody remembered the list existed.</li>
 * </ol>
 */
@DisplayName("audit allow-list ↔ publishers closure")
class AuditAllowListClosureTest {

    /** Run from the shared-lib module directory; the repository root is one level up. */
    private static final Path REPO_ROOT = Path.of("..").toAbsolutePath().normalize();

    /** {@code static final String NAME = "VALUE"} — how every event type is declared. */
    private static final Pattern CONSTANT =
            Pattern.compile("String\\s+([A-Z][A-Z0-9_]*)\\s*=\\s*\"([^\"]*)\"");

    /** The start of a publish call. The event type is its third argument. */
    private static final Pattern PUBLISH_CALL = Pattern.compile("\\.publish\\s*\\(");

    /** {@code SomeContract.EVENT_TYPE} — a constant referenced through its owning class. */
    private static final Pattern QUALIFIED_REF =
            Pattern.compile("\\b([A-Z][A-Za-z0-9_]*)\\.([A-Z][A-Z0-9_]{3,})\\b");

    /** A bare constant reference: same file, or statically imported. */
    private static final Pattern BARE_REF =
            Pattern.compile("(?<![.\\w])([A-Z][A-Z0-9_]{3,})\\b");

    /**
     * {@code import static a.b.SomeContract.*} / {@code ...SomeContract.SOME_CONST}.
     *
     * <p>Needed because a publisher that statically imports its contract refers to
     * {@code USER_CREATED} with no qualifier and no local declaration — which the first run of this
     * test could not resolve, so all six of the new user-lifecycle events looked unpublished. The
     * test reported a real-shaped failure for a wrong reason, which is its own kind of defect: a
     * closure test that cannot see a whole style of call site would have gone on passing after
     * someone "fixed" it by deleting the entries.
     */
    private static final Pattern STATIC_IMPORT =
            Pattern.compile("import\\s+static\\s+[\\w.]*?\\.([A-Z][A-Za-z0-9_]*)\\.(?:\\*|[A-Z][A-Z0-9_]*)\\s*;");

    private static final Pattern QUOTED = Pattern.compile("\"([^\"]*)\"");

    /** SCREAMING_SNAKE_CASE — what an event type looks like, and what a routing key does not. */
    private static final Pattern EVENT_TYPE_SHAPE = Pattern.compile("[A-Z][A-Z0-9_]{3,}");

    /** How far past {@code .publish(} to read while looking for the argument list. */
    private static final int CALL_WINDOW = 600;

    @Test
    @DisplayName("every must-audit event type is published by some service")
    void everyAllowListedTypeHasAPublisher() throws IOException {
        Set<String> published = publishedEventTypes();

        assertThat(published)
                .as("published event types parsed from the repository; a small set means the scan "
                        + "broke, not that the system publishes nothing")
                .hasSizeGreaterThan(20);

        Set<String> orphaned = new TreeSet<>(AuditEventCatalog.MUST_AUDIT);
        orphaned.removeAll(published);

        assertThat(orphaned)
                .as("""
                    Event types the audit allow-list waits for that NO service publishes.

                    Every one of these is an operation the audit trail claims to cover and silently
                    does not. There is no runtime symptom: ingestion matches nothing, writes nothing
                    and logs nothing, so the table simply stays empty for that operation while every
                    dashboard reports a healthy pipeline. This is how VOID_CREATED and REFUND_CREATED
                    left voids and refunds unaudited for fourteen phases.

                    Fix by one of:
                      - correcting the name in AuditEventCatalog.MUST_AUDIT to the type actually
                        published (check the publishing service, not this document);
                      - publishing the event, if the operation genuinely has no event yet;
                      - removing the entry, if the operation no longer exists.
                    """)
                .isEmpty();
    }

    @Test
    @DisplayName("every security-relevant published type is classified")
    void everySecurityRelevantPublishedTypeIsClassified() throws IOException {
        Set<String> unclassified = new TreeSet<>();

        for (String type : publishedEventTypes()) {
            boolean looksSecurityRelevant = AuditEventCatalog.SECURITY_RELEVANT_FRAGMENTS.stream()
                    .anyMatch(type::contains);
            if (looksSecurityRelevant
                    && !AuditEventCatalog.MUST_AUDIT.contains(type)
                    && !AuditEventCatalog.NOT_AUDIT_RELEVANT.contains(type)) {
                unclassified.add(type);
            }
        }

        assertThat(unclassified)
                .as("""
                    Published event types that name a privilege, a credential or a movement of money
                    and that the audit catalog has never been told about.

                    These produce no audit row. Not because anyone decided they should not — because
                    nobody decided anything, and an omission is indistinguishable from a judgement
                    when it is recorded nowhere.

                    Fix by adding each to either:
                      - AuditEventCatalog.MUST_AUDIT, if an auditor would want it (the default); or
                      - AuditEventCatalog.NOT_AUDIT_RELEVANT, with a comment saying why not.
                    """)
                .isEmpty();
    }

    // ───────────────────────────── the scan ─────────────────────────────

    /**
     * Every event type reachable as the third argument of a {@code publish(...)} call.
     *
     * <p>Resolves both literals and constant references, because the codebase uses both — some
     * services inline {@code "PO_APPROVED"} and others go through
     * {@code PurchasingEventContract.PO_APPROVED}. A reference is resolved against its own file
     * first and then, for a qualified reference, against the class that declares it; that
     * distinction matters because three payload contracts each declare a constant called
     * {@code EVENT_TYPE} and a single flat name-to-value map silently keeps only one of them.
     *
     * <p>audit-service is excluded from the scan: it is the consumer, and every allow-listed name
     * appears in it by definition. Including it would make the first test pass unconditionally.
     */
    private Set<String> publishedEventTypes() throws IOException {
        List<Path> sources = sourceFiles();

        Map<String, String> qualifiedConstants = new HashMap<>();
        Map<Path, Map<String, String>> fileConstants = new LinkedHashMap<>();

        for (Path file : sources) {
            String content = Files.readString(file, StandardCharsets.UTF_8);
            String className = file.getFileName().toString().replace(".java", "");
            Map<String, String> local = new HashMap<>();
            Matcher m = CONSTANT.matcher(content);
            while (m.find()) {
                local.put(m.group(1), m.group(2));
                qualifiedConstants.put(className + "." + m.group(1), m.group(2));
            }
            fileConstants.put(file, local);
        }

        Set<String> published = new TreeSet<>();
        for (Path file : sources) {
            String content = Files.readString(file, StandardCharsets.UTF_8);
            Map<String, String> local = fileConstants.get(file);

            // Classes this file statically imports from, so a bare USER_CREATED can be resolved
            // against the contract that declares it.
            List<String> staticallyImported = new java.util.ArrayList<>();
            Matcher staticImport = STATIC_IMPORT.matcher(content);
            while (staticImport.find()) {
                staticallyImported.add(staticImport.group(1));
            }

            Matcher call = PUBLISH_CALL.matcher(content);
            while (call.find()) {
                String args = argumentWindow(content, call.end());

                Matcher quoted = QUOTED.matcher(args);
                while (quoted.find()) {
                    addIfEventType(published, quoted.group(1));
                }
                Matcher qualified = QUALIFIED_REF.matcher(args);
                while (qualified.find()) {
                    addIfEventType(published,
                            qualifiedConstants.get(qualified.group(1) + "." + qualified.group(2)));
                }
                Matcher bare = BARE_REF.matcher(args);
                while (bare.find()) {
                    String name = bare.group(1);
                    addIfEventType(published, local.get(name));
                    for (String owner : staticallyImported) {
                        addIfEventType(published, qualifiedConstants.get(owner + "." + name));
                    }
                }
            }
        }
        return published;
    }

    /** The publish call's arguments: up to the statement terminator, bounded so a scan cannot run away. */
    private static String argumentWindow(String content, int from) {
        String window = content.substring(from, Math.min(content.length(), from + CALL_WINDOW));
        int end = window.indexOf(';');
        return end >= 0 ? window.substring(0, end) : window;
    }

    /**
     * Keeps SCREAMING_SNAKE values only, which is what filters routing keys and exchanges out:
     * {@code ORDER_VOIDED_KEY} resolves to {@code "pos.order.voided"} and is discarded, while
     * {@code ORDER_VOIDED_TYPE} resolves to {@code "ORDER_VOIDED"} and is kept.
     */
    private static void addIfEventType(Set<String> sink, String value) {
        if (value != null && EVENT_TYPE_SHAPE.matcher(value).matches()) {
            sink.add(value);
        }
    }

    private static List<Path> sourceFiles() throws IOException {
        List<Path> roots = List.of(
                REPO_ROOT.resolve("services"),
                REPO_ROOT.resolve("shared-lib").resolve("src").resolve("main"));

        List<Path> files = new java.util.ArrayList<>();
        for (Path root : roots) {
            if (!Files.isDirectory(root)) {
                continue;
            }
            try (Stream<Path> walk = Files.walk(root)) {
                walk.filter(Files::isRegularFile)
                    .filter(p -> p.toString().endsWith(".java"))
                    .filter(p -> p.toString().contains("/src/main/"))
                    // The consumer. Every allow-listed name appears here by definition.
                    .filter(p -> !p.toString().contains("/audit-service/"))
                    .filter(p -> !p.toString().contains("/target/"))
                    .forEach(files::add);
            }
        }
        return files;
    }
}
