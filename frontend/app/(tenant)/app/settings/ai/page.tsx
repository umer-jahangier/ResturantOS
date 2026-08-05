import { AiConfigForm } from "@/components/settings/ai-config-form";
import { FeatureGuard } from "@/components/shared/feature-guard";

export const metadata = {
  title: "AI Settings - RestaurantOS",
};

export default function AiSettingsPage() {
  return (
    <FeatureGuard feature="FEATURE_NLQ">
      <div className="flex h-full flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-6 lg:h-16">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              AI / NLQ Settings
            </h1>
          </div>
        </header>
        <div className="flex-1 overflow-auto bg-muted/20 p-6">
          <div className="mx-auto max-w-2xl">
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <AiConfigForm />
            </div>
          </div>
        </div>
      </div>
    </FeatureGuard>
  );
}
