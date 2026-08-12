package io.restaurantos.nlq.provider;

/**
 * One chat completion, provider-agnostic.
 *
 * <p>{@code userTurn} is UNTRUSTED — it carries the caller's raw natural-language question, a
 * prompt-injection vector. Implementations MUST place it only in the provider's user-message slot
 * and never concatenate it into {@code systemPrompt}. Nothing here makes the model's output safe;
 * the 7-stage {@code SqlValidationPipeline} does that.
 *
 * <p>{@code model} is chosen by the caller from resolved {@link LlmCredentials}, not by the
 * provider — one provider serves both the SQL model and the (cheaper) narrative model.
 */
public record LlmCall(String model, String systemPrompt, String userTurn, int maxTokens) {
}
