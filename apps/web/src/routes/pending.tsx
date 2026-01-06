import { useTranslation } from "react-i18next";

export default function Pending() {
  const { t } = useTranslation();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{t("pending.title")}</h1>
        <p className="text-muted-foreground">{t("pending.subtitle", { count: 0 })}</p>
      </div>
      <div className="rounded-xl border p-6">
        <p className="text-sm text-muted-foreground">Pending items coming soon...</p>
      </div>
    </div>
  );
}
