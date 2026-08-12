package io.restaurantos.pos.service;

import java.util.ArrayList;
import java.util.List;

/**
 * The branch's stored address, turned into the lines a receipt prints (S4).
 *
 * <h2>Why this is not a JSON parser, and why that sentence is the whole point</h2>
 *
 * <p>{@code branches.address} WAS a {@code jsonb} column, so {@code ReceiptDocumentAssembler} read
 * it with {@code objectMapper.readTree} and handled the object / array / bare-string shapes it
 * might hold. That column is {@code TEXT} as of user-service changeset 021 — the jsonb type was the
 * cause of a 409 CONFLICT on every plain address an owner could type into Settings.
 *
 * <p>Parsing plain text as JSON is not merely unnecessary now. It is wrong, and wrong in the worst
 * available way: {@code readTree("12 Khayaban-e-Iqbal, F-7 Markaz, Islamabad")} <b>does not
 * throw</b>. {@code FAIL_ON_TRAILING_TOKENS} is off by default, so Jackson reads the leading
 * {@code 12}, returns an {@code IntNode} and discards the rest. An IntNode is neither textual nor
 * an array nor an object, so the old code fell through every branch and returned an EMPTY list: the
 * address vanished from the customer's receipt with nothing logged and no exception raised. An
 * address beginning with a letter ("Islamabad") threw instead and was rescued by the catch — so the
 * failure was invisible in precisely the half of the cases most street addresses fall in.
 *
 * <p>So: no parser. The stored text is the address. Newlines separate lines, blank lines are
 * dropped, and nothing here can throw — a malformed address must never stop a customer getting a
 * bill.
 *
 * <p>A class of its own rather than a private method, so the behaviour above has a unit test that
 * needs no Spring context and no Testcontainers, and so the guard can be run against both the old
 * and the new implementation.
 */
public final class BranchAddressLines {

    private BranchAddressLines() {}

    /**
     * @param address the raw {@code branches.address} text; null or blank for a branch nobody has
     *                filled in, which is a normal branch
     * @return one entry per non-blank line, never null
     */
    public static List<String> of(String address) {
        if (address == null || address.isBlank()) {
            return List.of();
        }
        List<String> lines = new ArrayList<>();
        for (String line : address.split("\\R")) {
            String trimmed = line.strip();
            if (!trimmed.isEmpty()) {
                lines.add(trimmed);
            }
        }
        return List.copyOf(lines);
    }
}
