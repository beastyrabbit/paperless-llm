/**
 * A real link to an inspected Paperless document. Points at the app's own
 * document detail route (`/documents/{id}`), which resolves the document in
 * Paperless-ngx — never a dead `#id` label.
 */
import Link from "next/link";
import { FileText } from "lucide-react";
import type { DocumentId } from "@repo/api-contracts";

export function DocumentLink({
  documentId,
  className,
}: {
  documentId: DocumentId;
  className?: string;
}) {
  return (
    <Link
      href={`/documents/${documentId}`}
      className={
        className ??
        "inline-flex items-center gap-1 rounded font-mono text-[11px] text-emerald-700 underline decoration-dotted underline-offset-2 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
      }
      title={`Open Paperless document #${documentId}`}
    >
      <FileText className="h-3 w-3" aria-hidden="true" />#{documentId}
    </Link>
  );
}
