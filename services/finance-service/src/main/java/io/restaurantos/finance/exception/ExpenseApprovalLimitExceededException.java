package io.restaurantos.finance.exception;

public class ExpenseApprovalLimitExceededException extends RuntimeException {

    public ExpenseApprovalLimitExceededException() {
        super("Expense amount exceeds approver's OPA authorization limit");
    }
}
