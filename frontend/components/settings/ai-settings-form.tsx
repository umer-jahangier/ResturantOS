"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";

import { createZodResolver } from "@/lib/forms/zod-resolver";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { QueryBoundary } from "@/components/ui/query-boundary";
import {
  useAiSettings,
  useClearAiSettings,
  useUpdateAiSettings,
} from "@/lib/hooks/settings/use-ai-settings";
import { formatUserFacingError } from "@/lib/errors";
import { describeAiKeyState, formatKeyHint, type AiSettings } from "@/lib/models/ai-settings.model";

/**
 * Settings → AI. Where a restaurant supplies its OWN AI API key (Program C).
 *
 * <h3>What was wrong</h3>
 *
 * <p>nlq-service read ONE key from deploy config, so every tenant's questions billed to a single
 * Anthropic account with no per-tenant attribution, quota or isolation. That is a multi-tenancy
 * defect, not just a missing screen.
 *
 * <h3>The input is write-only, and there is nothing to populate it from</h3>
 *
 * <p>The field is `type="password"`, `autoComplete="off"`, and is NEVER seeded from the server
 * response — because the response has no key in it. `AiSettingsView` has no key component, the
 * response schema is `.strict()`, and there is no reveal endpoint. The screen shows four
 * characters and offers to REPLACE.
 *
 * <p>The submitted key is cleared from form state the moment the save succeeds, so it does not sit
 * in a mounted component for the rest of the session.
 *
 * <h3>Four states, all rendered</h3>
 *
 * <p>Platform key / your key verified / your key unverified / your key refused. UNVERIFIED is
 * shown as a caution rather than a failure: it means the provider was unreachable at save time,
 * not that the key is bad, and the first successful question promotes it automatically. Rendering
 * it red would send an owner to re-enter a key that is probably fine.
 */

const aiSettingsSchema = z.object({
  // Length only. A prefix/format check would reject valid keys the day the provider changes its
  // scheme — which Anthropic has already done once — with a message the user cannot act on. The
  // authoritative check is the server's save-time probe, which asks the provider itself.
  apiKey: z
    .string()
    .min(8, "That looks too short to be an API key")
    .max(512, "That is longer than any provider key"),
});

type AiSettingsFormValues = z.infer<typeof aiSettingsSchema>;

const TONE_VARIANT = {
  neutral: "default",
  success: "default",
  warning: "default",
  danger: "destructive",
} as const;

export function AiSettingsForm() {
  const query = useAiSettings();

  return (
    <QueryBoundary query={query} what="this restaurant's AI settings">
      {query.data && <AiSettingsFormInner settings={query.data} />}
    </QueryBoundary>
  );
}

function AiSettingsFormInner({ settings }: { settings: AiSettings }) {
  const update = useUpdateAiSettings();
  const clear = useClearAiSettings();
  const [replacing, setReplacing] = useState(settings.source === "PLATFORM");

  const form = useForm<AiSettingsFormValues>({
    resolver: createZodResolver(aiSettingsSchema),
    // Empty, always. There is no server value that could go here.
    defaultValues: { apiKey: "" },
  });

  const state = describeAiKeyState(settings);
  const disabled = !settings.canManage || !settings.storageAvailable;

  function onSubmit(values: AiSettingsFormValues) {
    update.mutate(
      { provider: "ANTHROPIC", apiKey: values.apiKey },
      {
        onSuccess: (saved) => {
          // Drop the key from form state immediately — it has done its job.
          form.reset({ apiKey: "" });
          setReplacing(false);
          toast.success(
            saved.keyState === "VERIFIED"
              ? "API key saved and verified"
              : "API key saved. We could not reach the provider to verify it yet.",
          );
        },
        onError: (error) => toast.error(formatUserFacingError(error)),
      },
    );
  }

  function onClear() {
    clear.mutate(undefined, {
      onSuccess: () => {
        form.reset({ apiKey: "" });
        setReplacing(true);
        toast.success("Removed. Questions now use the built-in AI key.");
      },
      onError: (error) => toast.error(formatUserFacingError(error)),
    });
  }

  return (
    <div className="space-y-6">
      <Alert variant={TONE_VARIANT[state.tone]} role="status">
        <AlertTitle>{state.title}</AlertTitle>
        <AlertDescription>
          {state.detail}
          {settings.keyLast4 ? (
            <>
              {" "}
              <span className="font-mono" data-testid="ai-key-hint">
                {formatKeyHint(settings.keyLast4)}
              </span>
            </>
          ) : null}
        </AlertDescription>
      </Alert>

      {!settings.storageAvailable ? (
        <Alert variant="destructive" role="status">
          <AlertTitle>Secure storage is not configured on this server</AlertTitle>
          <AlertDescription>
            An API key cannot be saved until an operator configures secure credential storage for
            this installation. Questions keep working on the built-in key in the meantime.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your AI API key</CardTitle>
          <CardDescription>
            Bring your own Anthropic API key so AI usage bills to your account instead of the
            platform&apos;s. We store it encrypted and never show it again — if you lose it, replace
            it with a new one from your provider.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {replacing ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="apiKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Anthropic API key</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          disabled={disabled || update.isPending}
                          placeholder="Paste your key"
                          aria-label="Anthropic API key"
                        />
                      </FormControl>
                      <FormDescription>
                        Create one in your Anthropic console. We check it with the provider before
                        saving, so a wrong key is refused straight away rather than failing later.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-2">
                  <Button type="submit" disabled={disabled || update.isPending}>
                    {update.isPending ? "Checking with the provider…" : "Save key"}
                  </Button>
                  {settings.source === "TENANT" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        form.reset({ apiKey: "" });
                        setReplacing(false);
                      }}
                      disabled={update.isPending}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </form>
            </Form>
          ) : (
            <div className="flex gap-2">
              <Button type="button" onClick={() => setReplacing(true)} disabled={disabled}>
                Replace key
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onClear}
                disabled={disabled || clear.isPending}
              >
                {clear.isPending ? "Removing…" : "Use the built-in key instead"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
