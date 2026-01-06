import { useTranslation } from "react-i18next";

export default function Settings() {
  const { t } = useTranslation();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
        <p className="text-muted-foreground">{t("settings.subtitle")}</p>
      </div>
      <div className="rounded-xl border p-6">
        <p className="text-sm text-muted-foreground">Settings coming soon...</p>
      </div>
    </div>
  );
}
