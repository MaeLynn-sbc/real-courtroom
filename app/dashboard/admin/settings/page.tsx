import type { Metadata } from "next";

import { ModuleTogglesPanel } from "@/features/settings/components/module-toggles-panel";
import { SettingsWorkspace } from "@/features/settings/components/settings-workspace";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Settings",
};

// No searchParams/dynamic segment/auth() call on this page to signal Next
// that it needs live rendering — without this, it gets statically
// prerendered at build time and would never reflect a newly added setting
// in production. See ARCHITECTURE.md's v1.1 addendum.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, enabledModules] = await Promise.all([
    settingsService.listSettings(),
    settingsService.getEnabledModules(),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">Facility-wide configuration values.</p>
      </div>

      <ModuleTogglesPanel enabledModules={enabledModules} />
      <SettingsWorkspace settings={settings} />
    </div>
  );
}
