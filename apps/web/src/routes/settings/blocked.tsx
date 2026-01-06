import { useTranslation } from "react-i18next";

export default function SettingsBlocked() {
  const { t } = useTranslation();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Blocked Suggestions</h1>
        <p className="text-muted-foreground">Manage blocked AI suggestions</p>
      </div>
      <div className="rounded-xl border p-6">
        <p className="text-sm text-muted-foreground">Blocked suggestions coming soon...</p>
      </div>
    </div>
  );
}
