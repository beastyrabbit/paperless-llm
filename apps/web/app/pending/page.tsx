"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  CheckCircle2, User, Tag, FileText, Check, X, Loader2, AlertCircle,
  Square, CheckSquare, Trash2, Search, Unlock, GitMerge, ArrowRight,
} from "lucide-react";
import {
  Card, CardContent, Button, Badge, Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, Input, cn,
} from "@repo/ui";
import { usePending, sections } from "@/hooks/usePending";
import { PendingHeader, RejectionDialog } from "@/components/pending";
import type { SchemaCleanupMetadata } from "@/lib/api";

const SECTION_ICONS = { correspondent: User, document_type: FileText, tag: Tag };

export default function PendingPage() {
  const t = useTranslations("pending");
  const p = usePending();

  // Auto-switch to first non-empty section
  useEffect(() => {
    const currentCount = p.getCount(p.activeSection);
    if (currentCount === 0 && p.totalCount > 0) {
      const firstNonEmpty = sections.find((s) => p.getCount(s.key) > 0);
      if (firstNonEmpty && firstNonEmpty.key !== p.activeSection) p.setActiveSection(firstNonEmpty.key);
    }
  }, [p.counts, p.activeSection, p.totalCount, p.getCount, p.setActiveSection]);

  const getFirstSentence = (text: string) => text.match(/^[^.!?]+[.!?]/)?.[0] || text;
  const getTypeDisplayName = (type: string) => {
    const baseType = type.replace(/^schema_/, "");
    return baseType === "correspondent" ? t("correspondents").toLowerCase().replace(/s$/, "")
      : baseType === "document_type" ? t("documentTypes").toLowerCase().replace(/s$/, "")
      : baseType === "tag" ? t("tags").toLowerCase().replace(/s$/, "") : baseType;
  };

  if (p.loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-zinc-500">{t("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      <PendingHeader t={t} totalCount={p.totalCount} cleanupCount={p.cleanupCount}
        blockedTotal={p.blockedItems?.total || 0} loading={p.loading} similarLoading={p.similarLoading}
        showCleanup={p.showCleanup} showBlocked={p.showBlocked}
        onFindSimilar={p.handleFindSimilar}
        onToggleCleanup={() => { p.setShowCleanup(!p.showCleanup); if (!p.showCleanup) p.setShowBlocked(false); }}
        onToggleBlocked={() => { p.setShowBlocked(!p.showBlocked); if (!p.showBlocked) p.setShowCleanup(false); }}
        onRefresh={() => p.loadData(true)} />

      <div className="p-8">
        {p.error && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
            <AlertCircle className="h-5 w-5" /><span>{p.error}</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => p.setError(null)}><X className="h-4 w-4" /></Button>
          </div>
        )}

        {/* Schema Cleanup View */}
        {p.showCleanup ? (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold flex items-center gap-2"><GitMerge className="h-5 w-5" />{t("cleanup.title")}</h2>
            <p className="text-sm text-zinc-500">{t("cleanup.description")}</p>
            {p.cleanupItems.length === 0 ? (
              <Card className="py-12"><CardContent className="flex flex-col items-center justify-center text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-4" />
                <h3 className="font-semibold text-lg mb-1">{t("cleanup.noItems")}</h3>
                <p className="text-zinc-500 text-sm">{t("cleanup.noItemsDesc")}</p>
              </CardContent></Card>
            ) : (
              <div className="space-y-4">
                {p.cleanupItems.map((item) => {
                  const meta = item.metadata as unknown as SchemaCleanupMetadata;
                  return (
                    <Card key={item.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={meta.cleanup_type === "merge" ? "default" : "destructive"}>
                              {meta.cleanup_type === "merge" ? t("cleanup.merge") : t("cleanup.delete")}
                            </Badge>
                            <span className="font-medium">{meta.entity_name}</span>
                            {meta.cleanup_type === "merge" && <><ArrowRight className="h-4 w-4 text-zinc-400" /><span className="text-emerald-600">{meta.target_name}</span></>}
                          </div>
                          <p className="text-sm text-zinc-500">{meta.source_name} → {meta.target_name || "delete"}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => p.handleCleanupApprove(item)} disabled={p.cleanupActionLoading === item.id}>
                            {p.cleanupActionLoading === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => p.handleCleanupReject(item)} disabled={p.cleanupActionLoading === item.id}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

        /* Blocked Items View */
        ) : p.showBlocked ? (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">{t("blocked.title")}</h2>
            {!p.blockedItems || p.blockedItems.total === 0 ? (
              <Card className="py-12"><CardContent className="flex flex-col items-center justify-center text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-4" />
                <h3 className="font-semibold text-lg mb-1">{t("blocked.noItems")}</h3>
              </CardContent></Card>
            ) : (
              <div className="space-y-4">
                {[...p.blockedItems.global_blocks, ...p.blockedItems.correspondent_blocks, ...p.blockedItems.document_type_blocks, ...p.blockedItems.tag_blocks].map((item) => (
                  <Card key={item.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <div><p className="font-medium">{item.suggestion_name}</p><p className="text-sm text-zinc-500">{item.block_type} - {item.rejection_category}</p></div>
                      <Button size="sm" variant="outline" onClick={() => p.handleUnblock(item.id)} disabled={p.unblockingId === item.id}>
                        {p.unblockingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

        /* Main Pending Items View */
        ) : (
          <>
            {p.totalCount === 0 ? (
              <Card className="py-16"><CardContent className="flex flex-col items-center justify-center text-center">
                <CheckCircle2 className="h-16 w-16 text-emerald-500 mb-6" />
                <h2 className="text-2xl font-bold mb-2">{t("allClear.title")}</h2>
                <p className="text-zinc-500 max-w-md">{t("allClear.description")}</p>
              </CardContent></Card>
            ) : (
              <div className="grid grid-cols-12 gap-6">
                {/* Section tabs */}
                <div className="col-span-3 space-y-2">
                  {sections.map((section) => {
                    const count = p.getCount(section.key);
                    const Icon = SECTION_ICONS[section.key];
                    return (
                      <button key={section.key} onClick={() => p.setActiveSection(section.key)}
                        className={cn("w-full flex items-center justify-between p-3 rounded-lg transition-colors",
                          p.activeSection === section.key ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30" : "hover:bg-zinc-100 dark:hover:bg-zinc-800")}>
                        <div className="flex items-center gap-3"><Icon className="h-5 w-5" /><span className="font-medium">{t(section.labelKey)}</span></div>
                        <Badge variant={p.activeSection === section.key ? "default" : "secondary"}>{count}</Badge>
                      </button>
                    );
                  })}
                </div>

                {/* Items list */}
                <div className="col-span-9 space-y-4">
                  {/* Bulk actions bar */}
                  <div className="flex items-center justify-between bg-white dark:bg-zinc-900 p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <Button variant="ghost" size="sm" onClick={p.toggleSelectAll}>
                        {p.filteredItems.length > 0 && p.filteredItems.every((i) => p.selectedItems.has(i.id)) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      </Button>
                      <span className="text-sm text-zinc-500">{p.selectedItems.size} selected</span>
                    </div>
                    {p.selectedItems.size > 0 && (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={p.handleBulkApprove} disabled={p.bulkLoading}><Check className="h-4 w-4 mr-1" />Approve</Button>
                        <Button size="sm" variant="destructive" onClick={p.openBulkRejectModal} disabled={p.bulkLoading}><Trash2 className="h-4 w-4 mr-1" />Reject</Button>
                      </div>
                    )}
                  </div>

                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <Input placeholder={t("search")} value={p.searchQuery} onChange={(e) => p.setSearchQuery(e.target.value)} className="pl-10" />
                    {p.searchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border rounded-lg shadow-lg z-10 max-h-48 overflow-auto">
                        {p.searchResults.map((name) => (
                          <button key={name} className="w-full text-left px-4 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm"
                            onClick={() => { /* Apply to selected items */ p.setSearchQuery(""); }}>{name}</button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Items */}
                  {p.filteredItems.length === 0 ? (
                    <Card className="py-12"><CardContent className="text-center text-zinc-500">{t("noItems")}</CardContent></Card>
                  ) : (
                    p.filteredItems.map((item) => (
                      <Card key={item.id} className={cn("p-4 transition-colors", p.selectedItems.has(item.id) && "ring-2 ring-emerald-500")}>
                        <div className="flex items-start gap-4">
                          <Button variant="ghost" size="sm" onClick={() => p.toggleSelectItem(item.id)}>
                            {p.selectedItems.has(item.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                          </Button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline">{getTypeDisplayName(item.type)}</Badge>
                              <span className="text-sm text-zinc-500">Doc #{item.doc_id}</span>
                            </div>
                            <p className="font-semibold text-lg mb-1">{p.selectedValues[item.id] || item.suggestion}</p>
                            {item.reasoning && (
                              <p className="text-sm text-zinc-500">
                                {p.expandedReasoning.has(item.id) ? item.reasoning : getFirstSentence(item.reasoning)}
                                {item.reasoning.length > 100 && (
                                  <button className="ml-1 text-emerald-600 hover:underline" onClick={() => p.toggleReasoning(item.id)}>
                                    {p.expandedReasoning.has(item.id) ? t("showLess") : t("showMore")}
                                  </button>
                                )}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => p.handleApprove(item.id)} disabled={p.actionLoading === item.id}>
                              {p.actionLoading === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => p.openRejectModal(item)} disabled={p.actionLoading === item.id}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Rejection Dialogs */}
      <RejectionDialog t={t} open={p.rejectModalOpen} onOpenChange={p.setRejectModalOpen} item={p.rejectingItem}
        blockType={p.blockType} setBlockType={p.setBlockType} category={p.rejectionCategory} setCategory={p.setRejectionCategory}
        reason={p.rejectionReason} setReason={p.setRejectionReason} loading={p.actionLoading !== null}
        onReject={p.handleReject} onCancel={() => { p.setRejectModalOpen(false); p.resetRejectForm(); }} />

      <RejectionDialog t={t} open={p.bulkRejectModalOpen} onOpenChange={p.setBulkRejectModalOpen} item={null}
        blockType={p.bulkBlockType} setBlockType={p.setBulkBlockType} category={p.bulkRejectionCategory} setCategory={p.setBulkRejectionCategory}
        reason={p.bulkRejectionReason} setReason={p.setBulkRejectionReason} loading={p.bulkLoading}
        onReject={p.handleBulkReject} onCancel={() => { p.setBulkRejectModalOpen(false); p.resetBulkRejectForm(); }}
        isBulk selectedCount={p.selectedItems.size} />

      {/* Similar Suggestions Modal */}
      <Dialog open={p.showSimilarModal} onOpenChange={p.setShowSimilarModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{t("similar.title")}</DialogTitle><DialogDescription>{t("similar.description")}</DialogDescription></DialogHeader>
          <div className="space-y-4 max-h-96 overflow-auto">
            {p.similarGroups.length === 0 ? (
              <p className="text-center text-zinc-500 py-8">{t("similar.noGroups")}</p>
            ) : (
              p.similarGroups.map((group, idx) => (
                <Card key={idx} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Input value={p.similarMergeNames[idx] || group.recommended_name}
                      onChange={(e) => p.setSimilarMergeNames((prev) => ({ ...prev, [idx]: e.target.value }))} className="max-w-xs" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => p.handleMergeSimilar(idx)} disabled={p.mergingGroupIndex === idx}>
                        {p.mergingGroupIndex === idx ? <Loader2 className="h-4 w-4 animate-spin" /> : t("similar.merge")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => p.handleDismissSimilar(idx)}>{t("similar.dismiss")}</Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">{group.suggestions.map((s, i) => <Badge key={i} variant="secondary">{s}</Badge>)}</div>
                </Card>
              ))
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => p.setShowSimilarModal(false)}>{t("similar.close")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
