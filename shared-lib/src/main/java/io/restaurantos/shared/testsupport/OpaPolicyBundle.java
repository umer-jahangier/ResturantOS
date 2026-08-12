package io.restaurantos.shared.testsupport;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Proves a Testcontainers OPA is actually holding the repository's policy bundle, before any test is
 * allowed to believe a decision it returns.
 *
 * <pre>{@code
 * static final GenericContainer<?> OPA = new GenericContainer<>(DockerImageName.parse("openpolicyagent/opa:1.17.1"))
 *         .withCommand("run", "--server", "--addr=0.0.0.0:8181", "/policies")
 *         .withExposedPorts(8181)
 *         // NOT withFileSystemBind — see below.
 *         .withCopyFileToContainer(MountableFile.forHostPath(policiesDir()), "/policies")
 *         .waitingFor(Wait.forHttp("/health").forPort(8181));
 *
 * static {
 *     OPA.start();
 *     OpaPolicyBundle.assertActuallyLoaded(opaBaseUrl(), "restaurantos/hr.rego");
 * }
 * }</pre>
 *
 * <h2>The bug this exists to defeat</h2>
 *
 * <p>An OPA server holding <b>no policy at all</b> is indistinguishable from a healthy one unless you
 * ask it the right question. It starts normally, answers {@code GET /health} with 200, and returns
 * {@code {}} for every data query — because in Rego an undefined rule is not an error, it is simply
 * undefined. {@code DefaultOpaClient} then reads an absent {@code allow} as {@code false}, which is the
 * correct fail-closed reading of that response. Every layer behaves correctly and the suite still lies.
 *
 * <p><b>The lie runs in the dangerous direction.</b> An empty bundle makes every allow-case fail and
 * every deny-case pass. These OPA harnesses are predominantly tenant- and branch-isolation suites — that
 * is, mostly deny assertions — so the suite goes <em>green</em> against a policy engine holding nothing.
 * A harness whose stated invariant is "all permissions granted, so a deny can only ever come from
 * scoping" has that invariant silently inverted: the denies now come from the absence of any rule.
 *
 * <p>The cause was always the same one line:
 * {@code .withFileSystemBind(policiesDir().toString(), "/policies", BindMode.READ_ONLY)}. A bind mount
 * is performed by the Docker daemon, so it can only see host paths inside the Docker VM's shared
 * directories. From a path the VM does not share — colima shares {@code /Users} but not
 * {@code /private/tmp}, which is where a git worktree commonly lands — the mount silently resolves to an
 * <b>empty</b> {@code /policies}. No warning, no failure, no log line. Hit and confirmed on 2026-08-12:
 * {@code curl <opa>/v1/policies} on such a container returned {@code {"result":[]}}.
 *
 * <p>{@code withCopyFileToContainer} is immune because Testcontainers streams the files over the Docker
 * API as a tar payload, and the host path is resolved by <em>this JVM</em>, which is subject to no such
 * sharing restriction. It works from any path. <b>Do not "simplify" it back to a bind mount.</b>
 *
 * <p>Diagnostic, one line: {@code curl -s <opaBaseUrl>/v1/policies | head -c 200}. An empty
 * {@code result} array is this bug and nothing else.
 *
 * <h2>Why the check is a hard failure at container start</h2>
 *
 * <p>Calling this from the same {@code static} block that starts the container means the guard cannot be
 * forgotten by a test class added later, and no test in the suite can run against an empty bundle. The
 * cost is that it surfaces as {@code ExceptionInInitializerError}, which JUnit attributes to every test
 * in the class rather than to one named test — so the message below states the whole diagnosis outright.
 * Otherwise the next person reads a mass context-load failure and goes hunting for a Spring wiring bug.
 *
 * <p>This checks that the module is <em>loaded and parsed</em>. It is complementary to, not a substitute
 * for, a decision-level positive control — a test asserting some known-good input evaluates to
 * {@code true}, which additionally pins the policy's meaning. See {@code VoidOwnOrderIT}'s
 * {@code assertPolicyBundleIsActuallyLoaded()} in pos-service for that form.
 */
public final class OpaPolicyBundle {

    private OpaPolicyBundle() {
    }

    /**
     * Fails unless the OPA at {@code opaBaseUrl} is serving every one of {@code expectedModules}.
     *
     * @param opaBaseUrl      e.g. {@code http://localhost:32768}, no trailing slash
     * @param expectedModules bundle-relative module ids as OPA reports them, e.g.
     *                        {@code restaurantos/hr.rego}
     * @throws IllegalStateException if OPA is unreachable, or is serving no policy, or is missing any
     *                               expected module — every one of which makes the suite's decisions
     *                               meaningless rather than merely wrong
     */
    public static void assertActuallyLoaded(String opaBaseUrl, String... expectedModules) {
        String body = getPolicies(opaBaseUrl);

        for (String module : expectedModules) {
            if (!body.contains(module)) {
                throw new IllegalStateException(
                        "OPA at " + opaBaseUrl + " is not serving '" + module + "', so every decision "
                        + "this suite makes would be a meaningless deny — an empty bundle denies "
                        + "everything while answering /health with 200, which turns deny-assertions "
                        + "green for the wrong reason.\n"
                        + "The usual cause is withFileSystemBind(): a bind mount only works from a host "
                        + "path inside the Docker VM's shared directories, and resolves to an EMPTY "
                        + "/policies from anywhere else (colima shares /Users but not /private/tmp, "
                        + "where git worktrees commonly land). Use "
                        + "withCopyFileToContainer(MountableFile.forHostPath(policiesDir()), \"/policies\") "
                        + "instead — it streams over the Docker API and works from any path.\n"
                        + "OPA reported these modules: " + body);
            }
        }
    }

    private static String getPolicies(String opaBaseUrl) {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(opaBaseUrl + "/v1/policies"))
                .timeout(Duration.ofSeconds(10))
                .GET()
                .build();

        // The container is already past its /health wait strategy, so one call should be enough. The
        // retry is for the transport flake TestContainerPorts documents — a published port whose
        // listener accepts and then writes zero bytes — which would otherwise be reported here as a
        // missing bundle and send the reader after entirely the wrong bug.
        IllegalStateException last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            try (HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(5))
                    .build()) {
                HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() != 200) {
                    throw new IllegalStateException(
                            "GET /v1/policies returned " + response.statusCode() + ": " + response.body());
                }
                return response.body();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Interrupted asking OPA which policies it holds", e);
            } catch (Exception e) {
                last = new IllegalStateException(
                        "Could not ask OPA at " + opaBaseUrl + " which policies it holds: " + e, e);
                sleep(500);
            }
        }
        throw last;
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }
}
