import { useTranslation } from "react-i18next";

export default function Dashboard() {
  const { t } = useTranslation();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{t("dashboard.title")}</h1>
        <p className="text-muted-foreground">{t("dashboard.subtitle")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Dashboard content will be migrated */}
        <div className="rounded-xl border p-6">
          <p className="text-sm text-muted-foreground">Dashboard content coming soon...</p>
        </div>
      </div>
    </div>
  );
}
