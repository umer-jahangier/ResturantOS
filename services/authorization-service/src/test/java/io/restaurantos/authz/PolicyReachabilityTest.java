package io.restaurantos.authz;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every Rego rule the policy bundle ships is one that some running code path actually evaluates.
 *
 * <p>This is {@code PermissionCatalogClosureTest}'s sibling, for the other half of the
 * authorization system. That test closed the loop between the permission codes the system
 * <em>enforces</em> and the codes the catalog <em>declares</em>. This one closes the loop between
 * the policy rules the bundle <em>defines</em> and the rules the services actually <em>call</em>.
 *
 * <h2>The defect class</h2>
 *
 * <p>A Rego rule with no caller is a <b>dead letter</b>: fully written, fully tested, enforcing
 * nothing. It is invisible to every existing signal. {@code opa test policies/} passes, because the
 * rule is correct. Coverage reports 100 %, because policy coverage measures the policy, not the
 * system. No Java test fails, because no Java code references it. The endpoint the rule was written
 * to guard keeps working — at the weaker, RBAC-only level — so nobody notices.
 *
 * <p>The 2026-08-07 authorization audit measured this repo at <b>6 of 22 rules reachable</b>. Four
 * entire modules were dead: {@code hr}, {@code rbac}, most of {@code finance}, and part of
 * {@code vendor}. The concrete cost was not theoretical: {@code hr.rego} requires
 * {@code same_tenant_and_branch} on all nine of its actions and had 28 passing tests, while
 * {@code EmployeeService.load(id)} resolved employees tenant-wide — so a manager at one branch could
 * read and modify salaries at another. The policy that forbade it had been written, reviewed,
 * tested and merged, and was never wired to a call site.
 *
 * <p>The point of this test is that "someone must remember to wire the policy" becomes a build
 * error. Adding a rule to a {@code .rego} file without adding a caller now fails CI on the branch
 * that introduces it.
 *
 * <h2>What it checks</h2>
 *
 * <ol>
 *   <li><b>Every rule carries an explicit action guard.</b> A rule body with no
 *       {@code input.action == "…"} matches on <em>any</em> action routed to its module. That is not
 *       a style preference: {@code pos.rego}'s void rules originally had no guard, so any future
 *       {@code pos} action evaluated by a holder of {@code pos.order.void.any} would have been
 *       allowed outright. Requiring the guard is also what makes {@code (module, action)} a total
 *       identity for a rule, which the other two checks depend on.</li>
 *   <li><b>No dead letters.</b> Every {@code (module, action)} the policies define is named by at
 *       least one call site under {@code services/*}{@code /src/main}.</li>
 *   <li><b>No phantom call sites.</b> Every {@code (module, action)} the Java code evaluates is
 *       implemented by at least one rule. The reverse drift is just as bad and much louder: OPA
 *       returns {@code result: false} for an undefined rule, so a phantom call site denies
 *       <em>everyone, always</em> — the fail-closed direction, but a broken feature all the same.
 *       That is exactly how {@code pos.order.void.any} was found: the policy read {@code .any}, the
 *       catalog granted {@code pos.order.void}.</li>
 * </ol>
 *
 * <p>Both vocabularies are read from the repository tree rather than a running OPA or a live
 * service, so this stays a fast unit test that fails on the branch introducing the drift rather
 * than in whichever environment someone first clicks the feature.
 *
 * <h2>Why the scan is textual</h2>
 *
 * <p>Same reasoning as the closure test: a full Rego parser and a full Java AST would be more
 * precise and would not run in a plain surefire test with no extra dependencies. The scan is
 * deliberately strict instead — it resolves same-file {@code String} constants (which is how
 * {@code OPA_ACTION_APPROVE_PO} and friends are written), and it <b>fails</b> rather than skips when
 * it cannot resolve an argument to a literal. A call site it cannot read is reported as
 * unresolvable, not silently dropped; silently dropping is how a scanner starts lying.
 */
class PolicyReachabilityTest {

    private static final Path REPO_ROOT = Path.of("..", "..").toAbsolutePath().normalize();

    /** {@code package restaurantos.<module>} */
    private static final Pattern REGO_PACKAGE = Pattern.compile("^package\\s+restaurantos\\.(\\w+)", Pattern.MULTILINE);

    /** An {@code allow if { … }} rule body. Rego v1; bodies in this bundle are never nested. */
    private static final Pattern REGO_ALLOW_RULE = Pattern.compile("allow\\s+if\\s*\\{([^}]*)}", Pattern.DOTALL);

    /** {@code input.action == "x"} inside a rule body. */
    private static final Pattern REGO_ACTION_GUARD = Pattern.compile("input\\.action\\s*==\\s*\"([^\"]+)\"");

    /** {@code private static final String NAME = "value";} */
    private static final Pattern JAVA_STRING_CONSTANT =
            Pattern.compile("static\\s+final\\s+String\\s+(\\w+)\\s*=\\s*\"([^\"]*)\"\\s*;");

    /**
     * {@code …authorize("module", "action", …)} — shared-lib's direct-OPA client.
     *
     * <p>The argument classes exclude parentheses, not just commas. With {@code [^,]} the Feign
     * form {@code authorizationClient.authorize(new AuthorizePayload("finance", OPA_ACTION_APPROVE,}
     * — a ONE-argument call — matched this two-argument pattern by running through the nested
     * constructor, so every Feign call site was reported twice and once wrongly.
     */
    private static final Pattern JAVA_DIRECT_AUTHORIZE =
            Pattern.compile("\\.authorize\\(\\s*([^,()]+?)\\s*,\\s*([^,()]+?)\\s*,", Pattern.DOTALL);

    /** {@code new …AuthorizePayload("module", "action", …)} — the Feign route via authorization-service. */
    private static final Pattern JAVA_AUTHORIZE_PAYLOAD =
            Pattern.compile("AuthorizePayload\\(\\s*([^,()]+?)\\s*,\\s*([^,()]+?)\\s*,", Pattern.DOTALL);

    /**
     * Rules deliberately left unwired, each with the reason and the decision that owns it.
     *
     * <p>An entry here is not a way to silence the test — it is a way to make a deliberate omission
     * <em>visible and reviewable</em>. The registry is checked in both directions: an entry that has
     * since been wired fails as a stale suppression, and an entry naming a rule that no longer
     * exists fails too. So a deferral cannot rot quietly, and it cannot be used to hide a rule that
     * someone later deletes.
     *
     * <p>Keep this empty. Every addition needs a written reason and a decision record.
     */
    private static final Map<String, String> DEFERRED = Map.of(
            "rbac/manage",
            "Wire-or-delete is an open user decision (authz audit W2-5). rbac.rego governs who may "
                    + "administer users, roles and branches; the actual grant/revoke path lives in "
                    + "user-service, which has no OPA client. Today that path is protected by "
                    + "@PreAuthorize plus RoleCeiling.requireAssignable — a real control, but one "
                    + "that does not apply rbac.rego's tenant/branch isolation clause. Wiring it "
                    + "means adding a hard OPA dependency to user-service (and therefore an OPA_URL "
                    + "in every environment); deleting it means retiring 11 passing tests. Neither "
                    + "is an implementation detail, so neither was decided unilaterally here.");

    @Test
    void everyPolicyRuleIsReachableFromRunningCode() throws IOException {
        Map<String, List<String>> rulesByModule = policyRules();
        Set<String> defined = flatten(rulesByModule);
        Set<String> called = callSites().keySet();

        assertThat(defined)
                .as("policy rules parsed from policies/restaurantos/*.rego; a small or empty set "
                        + "means the scan broke, not that the bundle is empty")
                .hasSizeGreaterThan(15);
        assertThat(called)
                .as("OPA call sites parsed from services/*/src/main; an empty set means the scan broke")
                .isNotEmpty();

        Set<String> dead = new TreeSet<>(defined);
        dead.removeAll(called);

        Set<String> unexpectedlyDead = new TreeSet<>(dead);
        unexpectedlyDead.removeAll(DEFERRED.keySet());

        assertThat(unexpectedlyDead)
                .as("""
                    DEAD LETTER POLICY RULES — defined in the Rego bundle, evaluated by no running \
                    code path.

                    Each of these is a control that was written, tested and merged, and that guards \
                    nothing. The endpoint it was written for still works, at whatever weaker level \
                    its @PreAuthorize provides, so no other signal will tell you. `opa test` passes \
                    and coverage reads 100 %, because both measure the policy rather than the system.

                    Fix by doing ONE of:
                      * add a call site — inject shared-lib's AuthorizationService (needs \
                    restaurantos.opa.url) and call authorize("<module>", "<action>", resource), or \
                    POST the same pair through the authorization-service Feign client; or
                      * delete the rule and its tests, and record why the control is not needed; or
                      * if the decision is genuinely open, add it to DEFERRED with a written reason.

                    Never widen an existing rule to absorb an unwired one. That is how two \
                    endpoints come to share one policy and drift apart.""")
                .isEmpty();

        Set<String> staleDeferrals = new TreeSet<>(DEFERRED.keySet());
        staleDeferrals.retainAll(called);
        assertThat(staleDeferrals)
                .as("Rules listed in DEFERRED that now HAVE a caller. The deferral is obsolete — "
                        + "delete the entry so the rule is protected by this test like every other.")
                .isEmpty();

        Set<String> phantomDeferrals = new TreeSet<>(DEFERRED.keySet());
        phantomDeferrals.removeAll(defined);
        assertThat(phantomDeferrals)
                .as("Rules listed in DEFERRED that no longer exist in the policy bundle. A deferral "
                        + "must not outlive the rule it defers — delete the entry.")
                .isEmpty();
    }

    @Test
    void everyCallSiteNamesARuleThatExists() throws IOException {
        Map<String, List<String>> callers = callSites();
        Set<String> defined = flatten(policyRules());

        Map<String, List<String>> phantom = new TreeMap<>();
        callers.forEach((rule, sites) -> {
            if (!defined.contains(rule)) {
                phantom.put(rule, sites);
            }
        });

        assertThat(phantom)
                .as("""
                    PHANTOM OPA CALL SITES — Java code evaluates a (module, action) pair that no \
                    Rego rule implements.

                    OPA answers an undefined rule with result:false, so these deny EVERY caller on \
                    EVERY tenant, including OWNER. Fail-closed, and a completely broken feature: the \
                    403 is indistinguishable from a legitimate refusal. This is the same shape as \
                    the pos.order.void.any outage, where the policy said `.any` and the catalog said \
                    `pos.order.void`.

                    Either add the rule (with tests) or correct the action string at the call site.""")
                .isEmpty();
    }

    @Test
    void everyPolicyRuleGuardsOnAnExplicitAction() throws IOException {
        Map<String, List<String>> unguarded = new TreeMap<>();
        for (Path rego : policyFiles()) {
            String text = Files.readString(rego, StandardCharsets.UTF_8);
            String module = module(rego, text);
            if (module == null) {
                continue;
            }
            Matcher rule = REGO_ALLOW_RULE.matcher(text);
            int index = 0;
            while (rule.find()) {
                index++;
                if (!REGO_ACTION_GUARD.matcher(rule.group(1)).find()) {
                    unguarded.computeIfAbsent(module, k -> new ArrayList<>())
                            .add("allow rule #" + index + " at " + rego.getFileName());
                }
            }
        }

        assertThat(unguarded)
                .as("""
                    UNGUARDED POLICY RULES — an `allow if { … }` body with no `input.action == "…"` \
                    test.

                    A rule with no action guard matches on ANY action routed to its module. It is \
                    latent rather than live only for as long as the module has exactly one caller: \
                    the day a second action is added, the holder of the first action's permission is \
                    silently allowed to perform it. pos.rego's void rules were written this way, so \
                    anyone holding pos.order.void.any would have been allowed every future pos \
                    action outright.

                    The guard is also what makes (module, action) a complete identity for a rule, \
                    which the reachability check above depends on — an unguarded rule cannot be \
                    matched to a caller at all.""")
                .isEmpty();
    }

    // ── policy side ──────────────────────────────────────────────────────────

    /** module → the actions its {@code allow} rules guard on. Several rules may share an action. */
    private static Map<String, List<String>> policyRules() throws IOException {
        Map<String, List<String>> byModule = new TreeMap<>();
        for (Path rego : policyFiles()) {
            String text = Files.readString(rego, StandardCharsets.UTF_8);
            String module = module(rego, text);
            if (module == null) {
                continue;
            }
            Matcher rule = REGO_ALLOW_RULE.matcher(text);
            while (rule.find()) {
                Matcher guard = REGO_ACTION_GUARD.matcher(rule.group(1));
                while (guard.find()) {
                    byModule.computeIfAbsent(module, k -> new ArrayList<>()).add(guard.group(1));
                }
            }
        }
        return byModule;
    }

    private static String module(Path rego, String text) {
        Matcher pkg = REGO_PACKAGE.matcher(text);
        if (!pkg.find()) {
            return null;
        }
        String module = pkg.group(1);
        // common.rego is a helper library — it defines no allow rule and is not addressable as
        // /v1/data/restaurantos/common/allow.
        return "common".equals(module) ? null : module;
    }

    private static List<Path> policyFiles() throws IOException {
        Path dir = REPO_ROOT.resolve("policies/restaurantos");
        try (Stream<Path> paths = Files.walk(dir)) {
            return paths.filter(p -> p.toString().endsWith(".rego")).sorted().toList();
        }
    }

    // ── call-site side ───────────────────────────────────────────────────────

    /** {@code "module/action"} → the files that evaluate it. */
    private static Map<String, List<String>> callSites() throws IOException {
        Map<String, List<String>> sites = new TreeMap<>();
        List<String> unresolvable = new ArrayList<>();

        for (Path java : javaSources()) {
            String text = Files.readString(java, StandardCharsets.UTF_8);
            Map<String, String> constants = stringConstants(text);
            for (Pattern pattern : List.of(JAVA_DIRECT_AUTHORIZE, JAVA_AUTHORIZE_PAYLOAD)) {
                Matcher call = pattern.matcher(text);
                while (call.find()) {
                    String module = literal(call.group(1), constants);
                    String action = literal(call.group(2), constants);
                    if (module == null || action == null) {
                        // The record DECLARATION itself matches (AuthorizePayload(String module,
                        // String action, …)); that is a type signature, not a call, and its
                        // "arguments" are parameter declarations. Anything else unresolvable is
                        // reported rather than dropped.
                        if (!isDeclaration(call.group(1), call.group(2))) {
                            unresolvable.add(java.getFileName() + ": " + call.group().replaceAll("\\s+", " "));
                        }
                        continue;
                    }
                    sites.computeIfAbsent(module + "/" + action, k -> new ArrayList<>())
                            .add(REPO_ROOT.relativize(java).toString());
                }
            }
        }

        assertThat(unresolvable)
                .as("OPA call sites whose module/action arguments this scan could not resolve to "
                        + "string literals. A call site the scanner cannot read is a rule it cannot "
                        + "prove reachable, so it is reported rather than ignored. Write the "
                        + "arguments as literals or as same-file `static final String` constants.")
                .isEmpty();

        return sites;
    }

    /** Distinguishes the {@code AuthorizePayload(String module, String action, …)} record header. */
    private static boolean isDeclaration(String first, String second) {
        return first.trim().startsWith("String ") && second.trim().startsWith("String ");
    }

    private static Map<String, String> stringConstants(String text) {
        Map<String, String> constants = new LinkedHashMap<>();
        Matcher m = JAVA_STRING_CONSTANT.matcher(text);
        while (m.find()) {
            constants.put(m.group(1), m.group(2));
        }
        return constants;
    }

    /** A quoted literal, or a same-file constant that resolves to one. Null when neither. */
    private static String literal(String argument, Map<String, String> constants) {
        String arg = argument.trim();
        if (arg.length() >= 2 && arg.startsWith("\"") && arg.endsWith("\"")) {
            return arg.substring(1, arg.length() - 1);
        }
        return constants.get(arg);
    }

    private static List<Path> javaSources() throws IOException {
        Path dir = REPO_ROOT.resolve("services");
        try (Stream<Path> paths = Files.walk(dir)) {
            return paths.filter(p -> p.toString().endsWith(".java"))
                    .filter(p -> p.toString().contains("src" + java.io.File.separator + "main"))
                    .filter(p -> !p.toString().contains(java.io.File.separator + "target" + java.io.File.separator))
                    .sorted()
                    .toList();
        }
    }

    private static Set<String> flatten(Map<String, List<String>> byModule) {
        Set<String> flat = new TreeSet<>();
        byModule.forEach((module, actions) -> actions.forEach(action -> flat.add(module + "/" + action)));
        return flat;
    }
}
