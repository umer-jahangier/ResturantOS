package io.restaurantos.nlq.validation.stage;

import io.restaurantos.nlq.validation.NlqRejectedException;
import io.restaurantos.nlq.validation.RejectionCode;
import net.sf.jsqlparser.JSQLParserException;
import net.sf.jsqlparser.expression.Expression;
import net.sf.jsqlparser.expression.ExpressionVisitorAdapter;
import net.sf.jsqlparser.expression.Parenthesis;
import net.sf.jsqlparser.expression.StringValue;
import net.sf.jsqlparser.expression.operators.conditional.AndExpression;
import net.sf.jsqlparser.expression.operators.relational.EqualsTo;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.schema.Column;
import net.sf.jsqlparser.schema.Table;
import net.sf.jsqlparser.statement.Statement;
import net.sf.jsqlparser.statement.select.PlainSelect;
import net.sf.jsqlparser.statement.select.Select;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Shared engine for {@link TenantFilterStage} and {@link BranchFilterStage} — inject
 * {@code column = '<value>'} into the WHERE clause via the AST, then re-parse the mutated SQL and
 * PROVE, by walking the re-parsed AST, that the predicate landed at the outermost conjunctive
 * level. If the proof cannot be constructed, the query is rejected — never executed on a
 * best-effort basis.
 *
 * <p>To keep the proof tractable, only a deliberately small query shape is supported: a single
 * {@link PlainSelect}, no CTEs, no JOINs, no subqueries anywhere in the WHERE clause, and a bare
 * {@link Table} FROM item. Anything wider is rejected here rather than risk an unprovable
 * rewrite — "a smaller provable surface beats a larger unprovable one" (plan 12-04). 12-07's
 * Claude system prompt instructs the model to generate only within this shape.
 */
final class PredicateInjector {

    private PredicateInjector() {
    }

    static String injectAndProve(String sql, String column, UUID value, RejectionCode failCode) {
        PlainSelect plainSelect = requireSupportedShape(safeParse(sql, failCode), failCode);
        Table table = (Table) plainSelect.getFromItem();

        EqualsTo predicate = new EqualsTo(new Column(table, column), new StringValue(value.toString()));
        Expression existingWhere = plainSelect.getWhere();
        Expression newWhere;
        if (existingWhere == null) {
            newWhere = predicate;
        } else {
            // Parenthesis.setExpression() does list.set(0, ...), which requires an element to
            // already be present — addExpression() is the correct way to populate a fresh one.
            Parenthesis wrapped = new Parenthesis();
            wrapped.addExpression(existingWhere);
            newWhere = new AndExpression(wrapped, predicate);
        }
        plainSelect.setWhere(newWhere);

        String rewritten = plainSelect.toString();

        // THE PROOF: re-parse our own output and re-walk it. Never trust the mutation we just made.
        PlainSelect proof = requireSupportedShape(safeParse(rewritten, failCode), failCode);
        if (!provesConjunctivePredicate(proof.getWhere(), column, value.toString())) {
            throw new NlqRejectedException(failCode,
                    "Could not prove the required filter is present after injection");
        }

        return rewritten;
    }

    private static Statement safeParse(String sql, RejectionCode failCode) {
        try {
            return CCJSqlParserUtil.parse(sql);
        } catch (JSQLParserException ex) {
            throw new NlqRejectedException(failCode, "Could not re-parse the query to prove it is safe");
        }
    }

    private static PlainSelect requireSupportedShape(Statement statement, RejectionCode failCode) {
        if (!(statement instanceof PlainSelect plainSelect)) {
            throw new NlqRejectedException(failCode, "Unsupported query shape (only a single SELECT is supported)");
        }
        if (plainSelect.getWithItemsList() != null && !plainSelect.getWithItemsList().isEmpty()) {
            throw new NlqRejectedException(failCode, "Unsupported query shape (CTEs are not supported)");
        }
        if (plainSelect.getJoins() != null && !plainSelect.getJoins().isEmpty()) {
            throw new NlqRejectedException(failCode, "Unsupported query shape (JOINs are not supported)");
        }
        if (!(plainSelect.getFromItem() instanceof Table)) {
            throw new NlqRejectedException(failCode, "Unsupported query shape (FROM must be a single table)");
        }
        if (containsSubquery(plainSelect.getWhere())) {
            throw new NlqRejectedException(failCode, "Unsupported query shape (subqueries are not supported)");
        }
        return plainSelect;
    }

    private static boolean containsSubquery(Expression where) {
        if (where == null) {
            return false;
        }
        SubqueryDetector detector = new SubqueryDetector();
        where.accept(detector, null);
        return detector.found;
    }

    /**
     * Flattens the top-level AND-tree (never descending into anything else — a parenthesised
     * sub-expression is treated as one opaque conjunct, exactly the property this proof relies
     * on) and checks whether any conjunct is EXACTLY {@code column = '<value>'}.
     */
    private static boolean provesConjunctivePredicate(Expression where, String column, String value) {
        if (where == null) {
            return false;
        }
        List<Expression> conjuncts = new ArrayList<>();
        flattenAnd(where, conjuncts);
        for (Expression conjunct : conjuncts) {
            if (isExactPredicate(conjunct, column, value)) {
                return true;
            }
        }
        return false;
    }

    private static void flattenAnd(Expression expression, List<Expression> out) {
        if (expression instanceof AndExpression and) {
            flattenAnd(and.getLeftExpression(), out);
            flattenAnd(and.getRightExpression(), out);
        } else {
            out.add(expression);
        }
    }

    private static boolean isExactPredicate(Expression expression, String column, String value) {
        if (!(expression instanceof EqualsTo equalsTo)) {
            return false;
        }
        if (!(equalsTo.getLeftExpression() instanceof Column left)) {
            return false;
        }
        if (!(equalsTo.getRightExpression() instanceof StringValue right)) {
            return false;
        }
        return left.getColumnName().toLowerCase(Locale.ROOT).equals(column.toLowerCase(Locale.ROOT))
                && right.getValue().equals(value);
    }

    private static final class SubqueryDetector extends ExpressionVisitorAdapter<Void> {
        boolean found = false;

        // Note: ParenthesedSelect does NOT override Expression#accept(ExpressionVisitor, S) — it
        // inherits Select's implementation, which dispatches to visit(Select, S), not
        // visit(ParenthesedSelect, S). Overriding the Select-typed overload is therefore the
        // correct (and only reliable) place to detect a subquery anywhere in an expression tree.
        @Override
        public <S> Void visit(Select select, S context) {
            found = true;
            return null;
        }
    }
}
