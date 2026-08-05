"use client";

import { useState } from "react";
import {
  useAiConfig,
  useSaveAiConfig,
  useDeleteAiConfig,
  useTestAiConnection,
  type ApiAiConfigRequest,
  type ApiAiConfigTestRequest,
} from "@/lib/hooks/settings/use-ai-config";

type AiProvider = "ANTHROPIC" | "OPENAI" | "GEMINI";

const PROVIDER_LABELS: Record<AiProvider, string> = {
  ANTHROPIC: "Claude (Anthropic)",
  OPENAI: "OpenAI",
  GEMINI: "Google Gemini",
};

const PROVIDER_DEFAULTS: Record<AiProvider, { sql: string; narrative: string }> = {
  ANTHROPIC: { sql: "claude-sonnet-4-6", narrative: "claude-haiku-4-5" },
  OPENAI: { sql: "gpt-4o", narrative: "gpt-4o-mini" },
  GEMINI: { sql: "gemini-2.5-flash", narrative: "gemini-2.5-flash" },
};

/**
 * The main BYOK settings form for per-tenant AI / LLM configuration.
 * Fetches config and delegates to AiConfigFormInner.
 */
export function AiConfigForm() {
  const { data: config, isLoading } = useAiConfig();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Once loaded, we render the inner form. If config is undefined/null, we pass null.
  return <AiConfigFormInner initialConfig={config ?? null} />;
}

function AiConfigFormInner({
  initialConfig,
}: {
  initialConfig: {
    provider: AiProvider;
    maskedApiKey: string | null;
    modelSql: string | null;
    modelNarrative: string | null;
    enabled: boolean;
  } | null;
}) {
  const saveMutation = useSaveAiConfig();
  const deleteMutation = useDeleteAiConfig();
  const testMutation = useTestAiConnection();

  const [provider, setProvider] = useState<AiProvider>(initialConfig?.provider ?? "ANTHROPIC");
  const [apiKey, setApiKey] = useState("");
  const [modelSql, setModelSql] = useState(initialConfig?.modelSql ?? "");
  const [modelNarrative, setModelNarrative] = useState(initialConfig?.modelNarrative ?? "");
  const [enabled, setEnabled] = useState(initialConfig?.enabled ?? true);
  
  // Track if we had a config initially, or if we successfully saved one.
  const hasExistingConfig = initialConfig !== null || saveMutation.isSuccess;
  const displayMaskedKey = initialConfig?.maskedApiKey ?? "****";

  // When provider changes, auto-fill model defaults (only if empty or matching previous defaults)
  const handleProviderChange = (newProvider: AiProvider) => {
    const oldDefaults = PROVIDER_DEFAULTS[provider];
    const newDefaults = PROVIDER_DEFAULTS[newProvider];
    setProvider(newProvider);
    if (!modelSql || modelSql === oldDefaults.sql) {
      setModelSql(newDefaults.sql);
    }
    if (!modelNarrative || modelNarrative === oldDefaults.narrative) {
      setModelNarrative(newDefaults.narrative);
    }
  };

  const handleSave = () => {
    const request: ApiAiConfigRequest = {
      provider,
      apiKey: apiKey || undefined,
      modelSql: modelSql || null,
      modelNarrative: modelNarrative || null,
      enabled,
    };
    saveMutation.mutate(request);
  };

  const handleDelete = () => {
    if (
      window.confirm(
        "Are you sure you want to remove your AI configuration? NLQ queries will stop working until you reconfigure.",
      )
    ) {
      deleteMutation.mutate();
      setApiKey("");
    }
  };

  const handleTest = () => {
    if (!apiKey && !hasExistingConfig) {
      return;
    }
    const request: ApiAiConfigTestRequest = {
      provider,
      apiKey: apiKey || "placeholder-uses-saved",
      modelSql: modelSql || null,
      modelNarrative: modelNarrative || null,
    };
    testMutation.mutate(request);
  };

  // If deleted, we consider it not having an existing config anymore.
  const showAsConfigured = hasExistingConfig && !deleteMutation.isSuccess;

  return (
    <div className="space-y-8">
      {/* Status Banner */}
      <StatusBanner configured={showAsConfigured} enabled={enabled} />

      {/* Provider Selector */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">AI Provider</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => handleProviderChange(p)}
              className={`rounded-lg border-2 px-4 py-3 text-left text-sm font-medium transition-all ${
                provider === p
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/5"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className={`h-3 w-3 rounded-full ${provider === p ? "bg-primary" : "bg-muted"}`} />
                {PROVIDER_LABELS[p]}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* API Key */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">API Key</h2>
        <div className="space-y-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={showAsConfigured ? displayMaskedKey : "Enter your API key"}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {showAsConfigured && (
            <p className="text-xs text-muted-foreground">
              A key is already saved ({displayMaskedKey}). Leave blank to keep the current key.
            </p>
          )}
        </div>
      </section>

      {/* Model Configuration */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Models</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="model-sql" className="text-xs font-medium text-muted-foreground">
              SQL Generation Model
            </label>
            <input
              id="model-sql"
              type="text"
              value={modelSql}
              onChange={(e) => setModelSql(e.target.value)}
              placeholder={PROVIDER_DEFAULTS[provider].sql}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-xs text-muted-foreground">
              Default: {PROVIDER_DEFAULTS[provider].sql}
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="model-narrative" className="text-xs font-medium text-muted-foreground">
              Narrative Model
            </label>
            <input
              id="model-narrative"
              type="text"
              value={modelNarrative}
              onChange={(e) => setModelNarrative(e.target.value)}
              placeholder={PROVIDER_DEFAULTS[provider].narrative}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-xs text-muted-foreground">
              Default: {PROVIDER_DEFAULTS[provider].narrative}
            </p>
          </div>
        </div>
      </section>

      {/* Enable/Disable Toggle */}
      <section className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
        <div>
          <p className="text-sm font-medium text-foreground">Enable NLQ</p>
          <p className="text-xs text-muted-foreground">
            Temporarily disable NLQ queries without removing your API key.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            enabled ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </section>

      {/* Test Connection */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleTest}
            disabled={testMutation.isPending || (!apiKey && !showAsConfigured)}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testMutation.isPending ? "Testing…" : "Test Connection"}
          </button>
          {testMutation.isSuccess && (
            <span
              className={`text-sm font-medium ${testMutation.data.success ? "text-emerald-600" : "text-red-500"}`}
            >
              {testMutation.data.success ? "✓ " : "✗ "}
              {testMutation.data.message}
            </span>
          )}
        </div>
      </section>

      {/* Action Buttons */}
      <section className="flex items-center gap-3 border-t border-border pt-6">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveMutation.isPending || (!apiKey && !showAsConfigured)}
          className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saveMutation.isPending ? "Saving…" : "Save Configuration"}
        </button>
        {showAsConfigured && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleteMutation.isPending ? "Removing…" : "Remove Configuration"}
          </button>
        )}
        {saveMutation.isSuccess && (
          <span className="text-sm font-medium text-emerald-600">✓ Saved successfully</span>
        )}
        {saveMutation.isError && (
          <span className="text-sm font-medium text-red-500">Failed to save. Please try again.</span>
        )}
      </section>
    </div>
  );
}

/** Status banner at the top of the form. */
function StatusBanner({ configured, enabled }: { configured: boolean; enabled: boolean }) {
  if (!configured) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900 dark:bg-red-950/30">
        <p className="text-sm font-medium text-red-700 dark:text-red-400">❌ AI is not configured</p>
        <p className="mt-1 text-xs text-red-600 dark:text-red-500">
          NLQ queries will not work until you configure an API key below.
        </p>
      </div>
    );
  }
  if (!enabled) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
          ⚠️ AI is configured but disabled
        </p>
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
          NLQ queries are paused. Toggle the switch below to re-enable.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950/30">
      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
        ✅ AI is configured and active
      </p>
      <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-500">NLQ queries are ready to use.</p>
    </div>
  );
}
