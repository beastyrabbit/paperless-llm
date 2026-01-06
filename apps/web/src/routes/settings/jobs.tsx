import { useTranslation } from "react-i18next";

export default function SettingsJobs() {
  const { t } = useTranslation();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Background Jobs</h1>
        <p className="text-muted-foreground">Manage background job execution</p>
      </div>
      <div className="rounded-xl border p-6">
        <p className="text-sm text-muted-foreground">Jobs management coming soon...</p>
      </div>
    </div>
  );
}
