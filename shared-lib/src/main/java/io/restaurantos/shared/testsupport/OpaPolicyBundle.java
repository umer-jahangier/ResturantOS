package io.restaurantos.shared.testsupport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * Proves a Testcontainers OPA is actually running the repository's policy bundle <b>as it exists on
 * disk</b>, before any test is allowed to believe a decision it returns.
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
 *     OpaPolicyBundle.assertActuallyLoaded(opaBaseUrl(), policiesDir(), "restaurantos/hr.rego");
 * }
 * }</pre>
 *
 * <p>This guards <b>two</b> silent-pass modes. Both have been observed in this repository, and both
 * leave the suite reporting success while proving nothing.
 *
 * <h2>1. The empty bundle</h2>
 *
 * <p>An OPA server holding <b>no policy at all</b> is indistinguishable from a healthy one unless you
 * ask it the right question. It starts normally, answers {@code GET /health} with 200, and returns
 * {@code {}} for every data query — because in Rego an undefined rule is not an error, it is simply
 * undefined. {@code DefaultOpaClient} then reads an absent {@code allow} as {@code false}, which is the
 * correct fail-closed reading of that response. Every layer behaves correctly and the suite still lies.
 *
 * <p><b>The lie runs in the dangerous direction.</b> An empty bundle makes every allow-case fail and
 * every deny-case pass. These OPA harnesses are predominantly tenant- and branch-isolation suites — that
 * is, mostly deny assertions — so any deny-case needing no allow-dependent fixture goes <em>green</em>
 * against an engine holding nothing. A harness whose stated invariant is "all permissions granted, so a
 * deny can only ever come from scoping" has that invariant silently inverted: the denies now come from
 * the absence of any rule.
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
 * <h2>2. The stale bundle</h2>
 *
 * <p>A bundle that loaded successfully but is <b>not the policy on disk</b> fails in a way that reads as
 * an application bug. Measured this cycle: an entire HR phase returned 403s naming a permission the
 * token demonstrably carried, because the OPA being queried was serving an older bundle. Nothing
 * anywhere said "the policy you are testing is not the policy you are editing", so the hunt went into
 * the service instead of the container.
 *
 * <p>Presence is therefore not enough. For every required module this compares OPA's own {@code raw}
 * source against the bytes on disk and fails on any difference. That check is what makes the copy above
 * <em>verified</em> rather than merely <em>believed</em>: it would also catch a reused container, a
 * half-finished copy, or an image with a policy baked in.
 *
 * <h2>Why the check is a hard failure at container start</h2>
 *
 * <p>Calling this from the same {@code static} block that starts the container means the guard cannot be
 * forgotten by a test class added later, and no test in the suite can run against a bad bundle. The cost
 * is that it surfaces as {@code ExceptionInInitializerError} — wrapped by Spring into a context-load
 * failure — so the message below states the whole diagnosis outright. Otherwise the next reader sees a
 * mass context-load failure and goes hunting for a Spring wiring bug.
 *
 * <p>Every assertion here is a counted or byte-compared one, never a truthiness check, and every failure
 * names which of the two modes it is. This guard has been watched failing in both directions; a guard
 * nobody has seen go red is not evidence.
 *
 * <p>Diagnostic, one line: {@code curl -s <opaBaseUrl>/v1/policies | head -c 200}. An empty
 * {@code result} array is mode 1 and nothing else.
 */
public final class OpaPolicyBundle {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private OpaPolicyBundle() {
    }

    /**
     * Fails unless the OPA at {@code opaBaseUrl} is serving exactly the bundle rooted at
     * {@code policiesDir}, including byte-identical source for each of {@code requiredModules}.
     *
     * @param opaBaseUrl      e.g. {@code http://localhost:32768}, no trailing slash
     * @param policiesDir     the host {@code policies/} directory that was copied into the container
     * @param requiredModules bundle-relative module paths that must be present AND current, e.g.
     *                        {@code restaurantos/hr.rego}
     * @throws IllegalStateException if OPA is unreachable, serving no policy, serving fewer modules
     *                               than exist on disk, missing a required module, or serving a
     *                               required module whose source differs from disk
     */
    public static void assertActuallyLoaded(String opaBaseUrl, Path policiesDir, String... requiredModules) {
        Map<String, String> served = fetchServedModules(opaBaseUrl);

        // Mode 1, the empty bundle. Counted, not truthy: zero is the signature of the bind-mount trap.
        if (served.isEmpty()) {
            throw new IllegalStateException(diagnosis(opaBaseUrl,
                    "is serving 0 policy modules", served, requiredModules));
        }

        // A floor derived from disk, so a partial copy is caught too — not just a wholly empty one.
        long onDisk = countRegoFiles(policiesDir);
        if (served.size() < onDisk) {
            throw new IllegalStateException(diagnosis(opaBaseUrl,
                    "is serving only " + served.size() + " policy modules but " + onDisk
                    + " .rego files exist under " + policiesDir + " — the bundle reached the container "
                    + "only partially", served, requiredModules));
        }

        for (String module : requiredModules) {
            String servedSource = served.entrySet().stream()
                    .filter(e -> e.getKey().equals(module) || e.getKey().endsWith("/" + module))
                    .map(Map.Entry::getValue)
                    .findFirst()
                    .orElseThrow(() -> new IllegalStateException(diagnosis(opaBaseUrl,
                            "is not serving '" + module + "'", served, requiredModules)));

            // Mode 2, the stale bundle. Byte comparison against disk, so "it loaded" is never mistaken
            // for "it loaded what I am editing".
            String onDiskSource = readModule(policiesDir, module);
            if (!normalise(servedSource).equals(normalise(onDiskSource))) {
                throw new IllegalStateException(
                        "OPA at " + opaBaseUrl + " is serving a STALE '" + module + "': the module it "
                        + "holds is not the one on disk at " + policiesDir.resolve(module) + ".\n"
                        + "Every decision this suite makes would be made by a policy you are not "
                        + "editing — the failure mode that reads as an application bug, e.g. a 403 "
                        + "naming a permission the token demonstrably carries.\n"
                        + "Rebuild/restart the OPA container so it re-copies the bundle; if this is a "
                        + "reused or externally-managed OPA, point the suite at a fresh one.\n"
                        + "Served source is " + servedSource.length() + " chars, disk source is "
                        + onDiskSource.length() + " chars.");
            }
        }
    }

    private static String diagnosis(String opaBaseUrl, String what, Map<String, String> served,
                                    String[] requiredModules) {
        return "OPA at " + opaBaseUrl + " " + what + ", so every decision this suite makes would be a "
               + "meaningless deny — an empty or partial bundle denies everything while answering "
               + "/health with 200, which turns deny-assertions green for the wrong reason.\n"
               + "The usual cause is withFileSystemBind(): a bind mount only works from a host path "
               + "inside the Docker VM's shared directories, and resolves to an EMPTY /policies from "
               + "anywhere else (colima shares /Users but not /private/tmp, where git worktrees "
               + "commonly land). Use "
               + "withCopyFileToContainer(MountableFile.forHostPath(policiesDir()), \"/policies\") "
               + "instead — it streams over the Docker API and works from any path.\n"
               + "Required: " + String.join(", ", requiredModules) + "\n"
               + "OPA is serving " + served.size() + " module(s): " + served.keySet();
    }

    /** Module id (as OPA reports it) to its raw source. */
    private static Map<String, String> fetchServedModules(String opaBaseUrl) {
        String body = getPolicies(opaBaseUrl);
        Map<String, String> modules = new LinkedHashMap<>();
        try {
            JsonNode result = MAPPER.readTree(body).path("result");
            for (JsonNode module : result) {
                modules.put(module.path("id").asText(), module.path("raw").asText(""));
            }
        } catch (IOException e) {
            throw new IllegalStateException(
                    "OPA at " + opaBaseUrl + " returned unparseable /v1/policies: " + body, e);
        }
        return modules;
    }

    private static long countRegoFiles(Path policiesDir) {
        try (Stream<Path> files = Files.walk(policiesDir)) {
            return files.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".rego"))
                    .count();
        } catch (IOException e) {
            throw new IllegalStateException("Could not count .rego files under " + policiesDir, e);
        }
    }

    private static String readModule(Path policiesDir, String module) {
        try {
            return Files.readString(policiesDir.resolve(module));
        } catch (IOException e) {
            throw new IllegalStateException(
                    "Required module '" + module + "' is not on disk under " + policiesDir
                    + " — the harness is asserting against a module that does not exist", e);
        }
    }

    /** Line endings and trailing whitespace only; anything else is a real difference. */
    private static String normalise(String source) {
        return source.replace("\r\n", "\n").stripTrailing();
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
        List<String> attempts = new ArrayList<>();
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
                attempts.add(e.toString());
                sleep(500);
            }
        }
        throw new IllegalStateException(
                "Could not ask OPA at " + opaBaseUrl + " which policies it holds after 3 attempts: "
                + attempts);
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
