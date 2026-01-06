import { useTranslation } from "react-i18next";

export default function Documents() {
  const { t } = useTranslation();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{t("documents.title")}</h1>
        <p className="text-muted-foreground">{t("documents.subtitle")}</p>
      </div>
      <div className="rounded-xl border p-6">
        <p className="text-sm text-muted-foreground">Documents list coming soon...</p>
      </div>
    </div>
  );
}
