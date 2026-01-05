#!/usr/bin/env python3
"""
Pipeline test script with document state backup/restore.

Tests multiple random documents through the full pipeline (including OCR)
and restores their original state afterwards.
"""

import asyncio
import json
import random
import sys
from dataclasses import dataclass

import httpx

from config import get_settings
from services.paperless import PaperlessClient


@dataclass
class DocumentBackup:
    """Stores original document state for restoration."""

    doc_id: int
    title: str
    correspondent_id: int | None
    document_type_id: int | None
    tag_ids: list[int]
    custom_fields: list[dict]
    content: str | None  # Original content (if we need to preserve it)


@dataclass
class TestResult:
    """Result of a single document test."""

    doc_id: int
    title: str
    success: bool
    steps_completed: list[str]
    error: str | None = None
    final_title: str | None = None
    final_correspondent: str | None = None
    final_document_type: str | None = None
    final_tags: list[str] | None = None


class PipelineTester:
    """Tests the document processing pipeline with state restoration."""

    def __init__(self):
        self.settings = get_settings()
        self.client = PaperlessClient(self.settings.paperless_url, self.settings.paperless_token)
        self.backups: dict[int, DocumentBackup] = {}
        self.results: list[TestResult] = []

    async def backup_document(self, doc_id: int) -> DocumentBackup | None:
        """Backup document state before testing."""
        doc = await self.client.get_document(doc_id)
        if not doc:
            print(f"  ❌ Document {doc_id} not found")
            return None

        backup = DocumentBackup(
            doc_id=doc_id,
            title=doc.get("title", ""),
            correspondent_id=doc.get("correspondent"),
            document_type_id=doc.get("document_type"),
            tag_ids=[t["id"] for t in doc.get("tags_data", [])],
            custom_fields=doc.get("custom_fields", []),
            content=doc.get("content"),
        )

        self.backups[doc_id] = backup
        print(f"  📦 Backed up: {backup.title[:50]}...")
        print(f"      Correspondent: {doc.get('correspondent_name', 'None')}")
        print(f"      Document Type: {doc.get('document_type_name', 'None')}")
        print(f"      Tags: {[t['name'] for t in doc.get('tags_data', [])]}")

        return backup

    async def restore_document(self, doc_id: int) -> bool:
        """Restore document to its original state."""
        backup = self.backups.get(doc_id)
        if not backup:
            print(f"  ❌ No backup found for document {doc_id}")
            return False

        print(f"  🔄 Restoring document {doc_id}...")

        try:
            # Get current document state
            doc = await self.client.get_document(doc_id)
            if not doc:
                return False

            current_tag_ids = [t["id"] for t in doc.get("tags_data", [])]

            # Remove all current tags
            for tag_id in current_tag_ids:
                await self.client._request(
                    "POST",
                    f"/documents/{doc_id}/tags/",
                    json={"tag": tag_id, "remove": True},
                )

            # Add back original tags
            for tag_id in backup.tag_ids:
                await self.client._request(
                    "POST",
                    f"/documents/{doc_id}/tags/",
                    json={"tag": tag_id, "remove": False},
                )

            # Restore other fields
            await self.client.update_document(
                doc_id,
                title=backup.title,
                correspondent_id=backup.correspondent_id,
                document_type_id=backup.document_type_id,
                custom_fields=backup.custom_fields,
            )

            print(f"  ✅ Restored: {backup.title[:50]}...")
            return True

        except Exception as e:
            print(f"  ❌ Restore failed: {e}")
            return False

    async def prepare_for_pipeline(self, doc_id: int, run_ocr: bool = True) -> bool:
        """Prepare document for pipeline testing."""
        doc = await self.client.get_document(doc_id)
        if not doc:
            return False

        current_tags = [t["name"] for t in doc.get("tags_data", [])]

        # Remove all LLM workflow tags
        llm_tags = [
            self.settings.tag_pending,
            self.settings.tag_ocr_done,
            self.settings.tag_correspondent_done,
            self.settings.tag_document_type_done,
            self.settings.tag_title_done,
            self.settings.tag_tags_done,
            self.settings.tag_processed,
        ]

        for tag in llm_tags:
            if tag in current_tags:
                await self.client.remove_tag_from_document(doc_id, tag)

        # Add appropriate starting tag
        if run_ocr:
            await self.client.add_tag_to_document(doc_id, self.settings.tag_pending)
            print(f"  🏷️  Set to: {self.settings.tag_pending} (full pipeline with OCR)")
        else:
            await self.client.add_tag_to_document(doc_id, self.settings.tag_ocr_done)
            print(f"  🏷️  Set to: {self.settings.tag_ocr_done} (skip OCR, use existing content)")

        return True

    async def run_pipeline(self, doc_id: int) -> TestResult:
        """Run the pipeline and collect results."""
        url = f"http://localhost:8000/api/processing/{doc_id}/stream"

        steps_completed = []
        error = None

        try:
            async with (
                httpx.AsyncClient(timeout=600.0) as client,
                client.stream("GET", url) as response,
            ):
                if response.status_code != 200:
                    text = await response.aread()
                    error = f"HTTP {response.status_code}: {text.decode()}"
                else:
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data = line[6:]
                            try:
                                event = json.loads(data)
                                event_type = event.get("type")

                                if event_type == "step_start":
                                    step = event.get("step", "unknown")
                                    print(f"      🚀 Starting: {step}")

                                elif event_type == "step_complete":
                                    step = event.get("step", "unknown")
                                    steps_completed.append(step)
                                    print(f"      ✅ Completed: {step}")

                                elif event_type == "error":
                                    error = event.get("message", "Unknown error")
                                    print(f"      ❌ Error: {error}")

                                elif event_type == "needs_review":
                                    step = event.get("step", "unknown")
                                    print(f"      ⚠️  Needs review: {step}")

                            except json.JSONDecodeError:
                                pass

        except httpx.TimeoutException:
            error = "Pipeline timeout (>10 minutes)"
        except Exception as e:
            error = str(e)

        # Get final state
        doc = await self.client.get_document(doc_id)
        backup = self.backups.get(doc_id)

        return TestResult(
            doc_id=doc_id,
            title=backup.title if backup else "Unknown",
            success=error is None and len(steps_completed) > 0,
            steps_completed=steps_completed,
            error=error,
            final_title=doc.get("title") if doc else None,
            final_correspondent=doc.get("correspondent_name") if doc else None,
            final_document_type=doc.get("document_type_name") if doc else None,
            final_tags=[t["name"] for t in doc.get("tags_data", [])] if doc else None,
        )

    async def get_random_documents(self, count: int = 10, max_id: int = 623) -> list[int]:
        """Get random document IDs."""
        # Simple approach: random IDs between 1 and max_id
        # We'll validate each document exists when we try to backup
        return random.sample(range(1, max_id + 1), count)

    async def test_document(
        self, doc_id: int, run_ocr: bool = True, restore: bool = True
    ) -> TestResult:
        """Test a single document through the pipeline."""
        print(f"\n{'='*70}")
        print(f"📄 Testing document {doc_id}")
        print("=" * 70)

        # Backup
        backup = await self.backup_document(doc_id)
        if not backup:
            return TestResult(
                doc_id=doc_id,
                title="Unknown",
                success=False,
                steps_completed=[],
                error="Failed to backup document",
            )

        # Prepare
        print("\n  🔧 Preparing for pipeline...")
        await self.prepare_for_pipeline(doc_id, run_ocr=run_ocr)

        # Run pipeline
        print("\n  🔄 Running pipeline...")
        result = await self.run_pipeline(doc_id)
        self.results.append(result)

        # Restore
        if restore:
            print("\n  🔄 Restoring original state...")
            await self.restore_document(doc_id)

        return result

    async def run_batch_test(self, count: int = 10, run_ocr: bool = True, restore: bool = True):
        """Run batch test on random documents."""
        print("\n" + "=" * 70)
        print(f"🧪 PIPELINE BATCH TEST - {count} Random Documents")
        print(f"   OCR: {'Enabled' if run_ocr else 'Disabled (using existing content)'}")
        print(f"   Restore: {'Yes' if restore else 'No'}")
        print("=" * 70)

        # Get random documents
        print("\n📋 Selecting random documents...")
        doc_ids = await self.get_random_documents(count)

        if not doc_ids:
            print("❌ No eligible documents found!")
            return

        print(f"   Selected: {doc_ids}")

        # Test each document
        for i, doc_id in enumerate(doc_ids, 1):
            print(f"\n\n{'#'*70}")
            print(f"# TEST {i}/{len(doc_ids)}")
            print("#" * 70)
            await self.test_document(doc_id, run_ocr=run_ocr, restore=restore)

        # Print summary
        self.print_summary()

    def print_summary(self):
        """Print test results summary."""
        print("\n\n" + "=" * 70)
        print("📊 TEST RESULTS SUMMARY")
        print("=" * 70)

        successes = [r for r in self.results if r.success]
        failures = [r for r in self.results if not r.success]

        print(f"\n✅ Successful: {len(successes)}/{len(self.results)}")
        print(f"❌ Failed: {len(failures)}/{len(self.results)}")

        if successes:
            print("\n" + "-" * 40)
            print("SUCCESSFUL TESTS:")
            print("-" * 40)
            for r in successes:
                print(f"\n  📄 Doc {r.doc_id}: {r.title[:40]}...")
                print(f"     Steps: {' → '.join(r.steps_completed)}")
                print(f"     Final title: {r.final_title}")
                print(f"     Correspondent: {r.final_correspondent}")
                print(f"     Document Type: {r.final_document_type}")

        if failures:
            print("\n" + "-" * 40)
            print("FAILED TESTS:")
            print("-" * 40)
            for r in failures:
                print(f"\n  📄 Doc {r.doc_id}: {r.title[:40]}...")
                print(f"     Steps completed: {r.steps_completed}")
                print(f"     Error: {r.error}")

        print("\n" + "=" * 70)


async def main():
    tester = PipelineTester()

    if len(sys.argv) > 1:
        # Test specific document(s)
        if sys.argv[1] == "--batch":
            count = int(sys.argv[2]) if len(sys.argv) > 2 else 10
            run_ocr = "--no-ocr" not in sys.argv
            restore = "--no-restore" not in sys.argv
            await tester.run_batch_test(count=count, run_ocr=run_ocr, restore=restore)
        else:
            doc_id = int(sys.argv[1])
            run_ocr = "--no-ocr" not in sys.argv
            restore = "--no-restore" not in sys.argv
            await tester.test_document(doc_id, run_ocr=run_ocr, restore=restore)
    else:
        # Default: batch test with 10 random documents
        await tester.run_batch_test(count=10, run_ocr=True, restore=True)


if __name__ == "__main__":
    print(
        """
Usage:
  python test_pipeline.py                    # Batch test 10 random docs with OCR
  python test_pipeline.py --batch 5          # Batch test 5 random docs
  python test_pipeline.py --batch 10 --no-ocr  # Skip OCR, use existing content
  python test_pipeline.py 123                # Test specific document
  python test_pipeline.py 123 --no-restore   # Test without restoring original state
"""
    )
    asyncio.run(main())
