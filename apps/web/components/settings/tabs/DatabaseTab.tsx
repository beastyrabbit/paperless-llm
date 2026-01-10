"use client";

import React from "react";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Upload,
  Database,
  Trash2,
  HardDrive,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/ui";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFunction = (key: string, values?: any) => string;

interface ConfigImportResult {
  success: boolean;
  message: string;
  imported_keys?: string[];
}

interface ClearDbResult {
  success: boolean;
  message: string;
  deleted_count?: number;
}

interface DatabaseTabProps {
  t: TranslationFunction;
  configImporting: boolean;
  configImportResult: ConfigImportResult | null;
  handleImportConfig: () => void;
  dbClearing: boolean;
  dbClearResult: ClearDbResult | null;
  handleClearDatabase: () => void;
}

export function DatabaseTab({
  t: _t,
  configImporting,
  configImportResult,
  handleImportConfig,
  dbClearing,
  dbClearResult,
  handleClearDatabase,
}: DatabaseTabProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <HardDrive className="h-6 w-6 text-zinc-500" />
        <div>
          <h2 className="text-lg font-semibold">Database Management</h2>
          <p className="text-sm text-zinc-500">
            Manage TinyBase settings database - import configuration or clear all settings
          </p>
        </div>
      </div>

      {/* Import Config Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Configuration
          </CardTitle>
          <CardDescription>
            Import settings from config.yaml file. This will add or update settings in the database.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Button
              onClick={handleImportConfig}
              disabled={configImporting}
              variant="outline"
            >
              {configImporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Import from config.yaml
            </Button>
          </div>

          {/* Import Result */}
          {configImportResult && (
            <div className={`p-4 rounded-lg ${
              configImportResult.success
                ? "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800"
                : "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
            }`}>
              <div className="flex items-start gap-2">
                {configImportResult.success ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <p className={`font-medium ${
                    configImportResult.success
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-red-700 dark:text-red-300"
                  }`}>
                    {configImportResult.success ? "Import Successful" : "Import Failed"}
                  </p>
                  <p className={`text-sm mt-1 ${
                    configImportResult.success
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}>
                    {configImportResult.message}
                  </p>
                  {configImportResult.success && configImportResult.imported_keys && configImportResult.imported_keys.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2 font-medium">
                        Imported {configImportResult.imported_keys.length} settings:
                      </p>
                      <div className="flex flex-wrap gap-1 max-h-48 overflow-y-auto">
                        {configImportResult.imported_keys.map((key) => (
                          <span key={key} className="text-xs px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-mono">
                            {key}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="text-sm text-zinc-500 space-y-2">
            <p>The config.yaml file is searched in the following locations:</p>
            <ul className="text-xs text-zinc-400 list-disc list-inside space-y-1 ml-2">
              <li>./config.yaml (current directory)</li>
              <li>../backend/config.yaml (Python backend)</li>
              <li>../../config.yaml (project root)</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Clear Database Card */}
      <Card className="border-red-200 dark:border-red-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <Trash2 className="h-5 w-5" />
            Clear Database
          </CardTitle>
          <CardDescription>
            Remove all settings from the TinyBase database. Use this to reset the database before reimporting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/30">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription>
              This action will delete all stored settings including API keys, model selections, and configuration.
              You will need to reimport or reconfigure settings after clearing.
            </AlertDescription>
          </Alert>

          <div className="flex items-center gap-4">
            <Button
              onClick={handleClearDatabase}
              disabled={dbClearing}
              variant="destructive"
            >
              {dbClearing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Clear All Settings
            </Button>
          </div>

          {/* Clear Result */}
          {dbClearResult && (
            <div className={`p-4 rounded-lg ${
              dbClearResult.success
                ? "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800"
                : "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
            }`}>
              <div className="flex items-start gap-2">
                {dbClearResult.success ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                )}
                <div>
                  <p className={`font-medium ${
                    dbClearResult.success
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-red-700 dark:text-red-300"
                  }`}>
                    {dbClearResult.success ? "Database Cleared" : "Clear Failed"}
                  </p>
                  <p className={`text-sm mt-1 ${
                    dbClearResult.success
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}>
                    {dbClearResult.message}
                    {dbClearResult.deleted_count !== undefined && (
                      <span> ({dbClearResult.deleted_count} settings removed)</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Database Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            About TinyBase Storage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-zinc-600 dark:text-zinc-400 space-y-2">
            <p>
              Settings are stored in an in-memory TinyBase database. This provides fast access
              and allows dynamic configuration changes without restarting the backend.
            </p>
            <p>
              The database is initialized from <code className="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-xs font-mono">config.yaml</code> on
              backend startup if empty. Changes made through the UI are stored in TinyBase and
              take precedence over the config file values.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
