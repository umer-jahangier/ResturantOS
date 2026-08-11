package io.restaurantos.user.dto;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * The typed, validated shape of {@code branches.receipt_config} — the printer registry (D-26-05).
 *
 * <h2>Why this column and not a new table</h2>
 *
 * <p>{@code BranchEntity} has declared {@code @Column(name = "receipt_config", columnDefinition =
 * "jsonb")} since the schema was first written, and the printing research independently names it
 * as the right home (§9.5). Phase 17 owns the tenant-configuration spine and has not landed; using
 * the column that already exists gives Phase 17 ONE place to migrate from instead of two. The
 * migration path is recorded in this plan's summary.
 *
 * <h2>Why every rule here is a constraint annotation</h2>
 *
 * <p>The register's GA-022 records a field accepted with a 200 and silently discarded. A printer
 * registry that is accepted and unusable is that defect with a kitchen attached: the tickets go
 * nowhere and the failure presents as silence. So the rules are declarative and enforced by the
 * validator before the service ever sees the object, and the 400 that comes back names the field.
 *
 * <h2>What must never go in here</h2>
 *
 * <p>No secret of any kind. This blob is returned verbatim to the configuration UI, so anything
 * placed here is readable by every user who can open the settings screen. The print agent's
 * credential is a separate hashed row and belongs to plan 26-11.
 */
public final class ReceiptConfigDtos {

    private ReceiptConfigDtos() {}

    /** An immutable copy with any null elements dropped; an empty list for a null input. */
    private static <T> List<T> nonNullCopy(List<T> input) {
        return input == null ? List.of() : input.stream().filter(Objects::nonNull).toList();
    }

    /** What a printer is FOR. Routing is by role first, then by terminal, then by station. */
    public enum PrinterRole { RECEIPT, KITCHEN }

    /**
     * How the agent reaches the printer. {@code TCP} is a raw socket to {@code host:port} (the
     * research's recommended shape — §9.3 decision 5); {@code SYSTEM} hands the bytes to the
     * operating system's own print queue by name, for the USB printer bolted to a till.
     */
    public enum Transport { TCP, SYSTEM }

    /** Mirrors {@code PrintDocument.CutMode} — the same closed set, on the configuration side. */
    public enum CutMode { NONE, PARTIAL, FULL }

    /**
     * Where the branch's print agent listens. {@code baseUrl} is the loopback address the POS tab
     * posts to; {@code lanUrl} is the same agent reachable from other tills on the branch LAN.
     */
    public record AgentEndpoint(
            @NotBlank(message = "agent base URL is required")
            @Pattern(regexp = "^https?://[^\\s]+$", message = "agent base URL must be an http(s) URL")
            String baseUrl,

            @Pattern(regexp = "^https?://[^\\s]+$", message = "agent LAN URL must be an http(s) URL")
            String lanUrl
    ) {}

    /**
     * One physical printer.
     *
     * @param id           stable identifier, referenced by print jobs and by the routing table
     * @param terminalId   the POS terminal this printer belongs to; NULL means it is the branch
     *                     default for its role. D-26-05 requires terminal granularity even though
     *                     the first UI only exposes branch defaults, because retro-fitting a
     *                     terminal dimension onto stored rows is a migration and adding it now is
     *                     a nullable field
     * @param stationCode  which kitchen station this printer serves; meaningful only for
     *                     {@link PrinterRole#KITCHEN}
     * @param columns      characters per line. NOT a compiled constant used for rendering —
     *                     research §7.5 could not establish a canonical column count for ANY
     *                     model, because it is a function of model, configured print width, font
     *                     and codepage together. A default exists so the form is usable; the real
     *                     value is measured on the hardware
     * @param columnsMeasured false until somebody has run the ruler print against this printer and
     *                        confirmed the number. A stored-but-unconfirmed column count is a
     *                        different thing from a measured one and the UI must be able to say so
     * @param drawerPin    ESC/POS connector pin, 2 or 5 (research §7.2: {@code m = 0} selects pin
     *                     2 and {@code m = 1} selects pin 5). Receipt printers only
     * @param drawerPulseMs on-time in milliseconds; the command encodes it as {@code t1 x 2 ms},
     *                      so the useful range tops out around half a second
     */
    @PrinterEntryConsistent
    public record PrinterEntry(
            @NotBlank(message = "printer id is required")
            @Size(max = 64, message = "printer id must be at most 64 characters")
            String id,

            UUID terminalId,

            @NotNull(message = "printer role is required")
            PrinterRole role,

            @Size(max = 64, message = "station code must be at most 64 characters")
            String stationCode,

            @NotNull(message = "transport is required")
            Transport transport,

            @Size(max = 253, message = "host must be at most 253 characters")
            String host,

            @Min(value = 1, message = "port must be between 1 and 65535")
            @Max(value = 65535, message = "port must be between 1 and 65535")
            Integer port,

            @Size(max = 255, message = "system printer name must be at most 255 characters")
            String systemPrinterName,

            @NotNull(message = "physical width in millimetres is required")
            @Min(value = 20, message = "widthMm must be between 20 and 210")
            @Max(value = 210, message = "widthMm must be between 20 and 210")
            Integer widthMm,

            @NotNull(message = "columns per line is required")
            @Min(value = 16, message = "columns must be between 16 and 255")
            @Max(value = 255, message = "columns must be between 16 and 255")
            Integer columns,

            boolean columnsMeasured,

            @NotBlank(message = "codepage is required")
            @Size(max = 32, message = "codepage must be at most 32 characters")
            String codepage,

            @NotNull(message = "cut mode is required")
            CutMode cut,

            Integer drawerPin,

            @Min(value = 10, message = "drawer pulse must be between 10 and 500 ms")
            @Max(value = 500, message = "drawer pulse must be between 10 and 500 ms")
            Integer drawerPulseMs
    ) {}

    public record HeaderConfig(
            UUID logoFileId,
            List<@Size(max = 96, message = "a header line must be at most 96 characters") String> lines
    ) {
        public HeaderConfig {
            lines = nonNullCopy(lines);
        }
    }

    public record FooterConfig(
            List<@Size(max = 96, message = "a footer line must be at most 96 characters") String> lines
    ) {
        public FooterConfig {
            lines = nonNullCopy(lines);
        }
    }

    /**
     * @param qrSizeMm the physical QR size. The DI spec fixes 1.0 inch = 25.4 mm, which is why this
     *                 is an exact decimal rather than an integer, and never a floating-point type
     */
    public record FbrPrintPreferences(
            boolean printLogo,

            @jakarta.validation.constraints.DecimalMin(value = "5.0", message = "qrSizeMm must be between 5 and 60")
            @jakarta.validation.constraints.DecimalMax(value = "60.0", message = "qrSizeMm must be between 5 and 60")
            BigDecimal qrSizeMm
    ) {}

    /**
     * The whole registry for one branch.
     *
     * @param kitchenStations the station codes this branch operates. Declared HERE rather than
     *                        fetched from pos-service so the completeness report is answerable
     *                        without a cross-service call at write time — and so a branch can say
     *                        "we run HOT and COLD" before any menu item has been assigned
     */
    @RoutingUnambiguous
    public record ReceiptConfig(
            @Valid AgentEndpoint agent,
            @Valid List<PrinterEntry> printers,
            @Valid HeaderConfig header,
            @Valid FooterConfig footer,
            @Valid FbrPrintPreferences fbr,
            List<@Size(max = 64) String> kitchenStations
    ) {
        public ReceiptConfig {
            // A JSON array element of `null` is a client mistake, not a server crash: filtered out
            // here rather than left for List.copyOf to raise an NPE that surfaces as a 500.
            printers = nonNullCopy(printers);
            kitchenStations = nonNullCopy(kitchenStations);
        }

        /**
         * The configuration of a branch that has never been configured. Explicitly EMPTY, never
         * null — a caller must be able to tell "nothing is configured here" from "the read
         * failed", and a null body makes those two indistinguishable.
         */
        public static ReceiptConfig empty() {
            return new ReceiptConfig(null, List.of(), null, null, null, List.of());
        }
    }

    /**
     * What is still missing after a successful save.
     *
     * <p>A configuration that declares a kitchen station no printer routes is SAVED — half a
     * configuration is a legitimate stopping point during onboarding — but the response says so.
     * Staying silent about it is how a kitchen ticket gets enqueued for a destination that does
     * not exist, and that failure presents as a kitchen that simply never prints.
     */
    public record CompletenessReport(
            boolean complete,
            List<String> unroutedStations,
            List<String> warnings
    ) {
        public CompletenessReport {
            unroutedStations = unroutedStations == null ? List.of() : List.copyOf(unroutedStations);
            warnings = warnings == null ? List.of() : List.copyOf(warnings);
        }
    }

    /** What both endpoints return: the stored configuration plus what is still missing from it. */
    public record ReceiptConfigResponse(ReceiptConfig config, CompletenessReport completeness) {}

    // ══ Cross-field constraints ═══════════════════════════════════════════════════════════════
    //
    // These are class-level constraints rather than checks inside the service on purpose: a rule
    // that lives in the service runs only on the paths that remembered to call it, and the
    // violation it raises does not carry a field path the UI can attach to an input.

    @Documented
    @Target(ElementType.TYPE)
    @Retention(RetentionPolicy.RUNTIME)
    @Constraint(validatedBy = PrinterEntryConsistentValidator.class)
    public @interface PrinterEntryConsistent {
        String message() default "printer entry is internally inconsistent";
        Class<?>[] groups() default {};
        Class<? extends Payload>[] payload() default {};
    }

    public static class PrinterEntryConsistentValidator
            implements ConstraintValidator<PrinterEntryConsistent, PrinterEntry> {

        /** ESC/POS defines exactly two drawer connector pins (research §7.2). */
        private static final Set<Integer> DRAWER_PINS = Set.of(2, 5);

        @Override
        public boolean isValid(PrinterEntry entry, ConstraintValidatorContext ctx) {
            if (entry == null) return true;
            ctx.disableDefaultConstraintViolation();
            boolean valid = true;

            if (entry.transport() == Transport.TCP) {
                if (isBlank(entry.host())) {
                    valid = reject(ctx, "host", "host is required for the TCP transport");
                }
                if (entry.port() == null) {
                    valid = reject(ctx, "port", "port is required for the TCP transport");
                }
            } else if (entry.transport() == Transport.SYSTEM && isBlank(entry.systemPrinterName())) {
                valid = reject(ctx, "systemPrinterName",
                        "systemPrinterName is required for the SYSTEM transport");
            }

            if (entry.drawerPin() != null && !DRAWER_PINS.contains(entry.drawerPin())) {
                valid = reject(ctx, "drawerPin",
                        "drawerPin must be 2 or 5 — ESC/POS defines no other connector pin");
            }
            if (entry.role() == PrinterRole.KITCHEN && entry.drawerPin() != null) {
                valid = reject(ctx, "drawerPin", "a KITCHEN printer must not drive the cash drawer");
            }
            if (entry.role() == PrinterRole.RECEIPT && !isBlank(entry.stationCode())) {
                valid = reject(ctx, "stationCode", "stationCode is meaningful only for a KITCHEN printer");
            }
            return valid;
        }

        private static boolean reject(ConstraintValidatorContext ctx, String property, String message) {
            ctx.buildConstraintViolationWithTemplate(message)
                    .addPropertyNode(property)
                    .addConstraintViolation();
            return false;
        }

        private static boolean isBlank(String s) {
            return s == null || s.isBlank();
        }
    }

    @Documented
    @Target(ElementType.TYPE)
    @Retention(RetentionPolicy.RUNTIME)
    @Constraint(validatedBy = RoutingUnambiguousValidator.class)
    public @interface RoutingUnambiguous {
        String message() default "printer routing is ambiguous";
        Class<?>[] groups() default {};
        Class<? extends Payload>[] payload() default {};
    }

    /**
     * Two printers claiming the same routing slot is not a preference, it is a coin toss at print
     * time — and the coin is tossed in a kitchen at eight o'clock on a Friday. Rejected, naming
     * both entry ids so the operator knows which two to look at.
     */
    public static class RoutingUnambiguousValidator
            implements ConstraintValidator<RoutingUnambiguous, ReceiptConfig> {

        @Override
        public boolean isValid(ReceiptConfig config, ConstraintValidatorContext ctx) {
            if (config == null || config.printers() == null) return true;

            Map<String, String> firstIdBySlot = new HashMap<>();
            Set<String> seenIds = new HashSet<>();
            List<String> problems = new ArrayList<>();

            for (PrinterEntry entry : config.printers()) {
                if (entry == null || entry.role() == null) continue;
                if (entry.id() != null && !seenIds.add(entry.id())) {
                    problems.add("duplicate printer id '" + entry.id() + "'");
                    continue;
                }
                String slot = entry.role().name()
                        + "|" + Objects.toString(entry.terminalId(), "BRANCH_DEFAULT")
                        + "|" + Objects.toString(entry.stationCode(), "");
                String previous = firstIdBySlot.putIfAbsent(slot, entry.id());
                if (previous != null) {
                    problems.add("printers '" + previous + "' and '" + entry.id()
                            + "' both claim role " + entry.role()
                            + (entry.stationCode() == null ? "" : " station " + entry.stationCode())
                            + (entry.terminalId() == null ? " as the branch default"
                                                          : " on terminal " + entry.terminalId()));
                }
            }

            if (problems.isEmpty()) return true;
            ctx.disableDefaultConstraintViolation();
            ctx.buildConstraintViolationWithTemplate(String.join("; ", problems))
                    .addPropertyNode("printers")
                    .addConstraintViolation();
            return false;
        }
    }
}
