import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Document #{id}</h1>
        <p className="text-muted-foreground">{t("documents.content")}</p>
      </div>
      <div className="rounded-xl border p-6">
        <p className="text-sm text-muted-foreground">Document detail coming soon...</p>
      </div>
    </div>
  );
}
