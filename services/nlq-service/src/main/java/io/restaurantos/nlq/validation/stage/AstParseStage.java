package io.restaurantos.nlq.validation.stage;

import io.restaurantos.nlq.validation.NlqRejectedException;
import io.restaurantos.nlq.validation.RejectionCode;
import net.sf.jsqlparser.JSQLParserException;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.statement.Statement;
import net.sf.jsqlparser.statement.select.Select;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Stage 2 — the real AST parse.
 *
 * <p>JSqlParser 5.3's {@code CCJSqlParserUtil} does not expose a {@code withTimeOut(...)} builder
 * method on this version (checked against the actual jar, not assumed from older docs) — a
 * pathological input must still not hang a request thread, so the parse is bounded with an
 * explicit {@link CompletableFuture#get(long, TimeUnit)} timeout instead.
 */
public class AstParseStage {

    private static final long PARSE_TIMEOUT_MS = 1000;

    private final Executor executor;

    public AstParseStage() {
        this(Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "nlq-sql-parse");
            t.setDaemon(true);
            return t;
        }));
    }

    AstParseStage(Executor executor) {
        this.executor = executor;
    }

    public Select parse(String sql) {
        CompletableFuture<Statement> future = CompletableFuture.supplyAsync(() -> {
            try {
                return CCJSqlParserUtil.parse(sql);
            } catch (JSQLParserException ex) {
                throw new NlqRejectedException(RejectionCode.PARSE_FAILED, "SQL could not be parsed");
            }
        }, executor);

        Statement statement;
        try {
            statement = future.get(PARSE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException ex) {
            future.cancel(true);
            throw new NlqRejectedException(RejectionCode.PARSE_FAILED, "SQL parse timed out");
        } catch (ExecutionException ex) {
            if (ex.getCause() instanceof NlqRejectedException rejected) {
                throw rejected;
            }
            throw new NlqRejectedException(RejectionCode.PARSE_FAILED, "SQL could not be parsed");
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new NlqRejectedException(RejectionCode.PARSE_FAILED, "SQL parse interrupted");
        }

        if (!(statement instanceof Select select)) {
            // Shape stage already guarantees this in the pipeline, but this class is usable
            // standalone (e.g. by TenantFilterStage's post-injection proof), so re-assert it.
            throw new NlqRejectedException(RejectionCode.PARSE_FAILED, "Only SELECT statements are permitted");
        }
        return select;
    }
}
