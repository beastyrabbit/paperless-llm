import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsTab } from "../app/settings/components/ConnectionsTab";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getReadiness: vi.fn(),
  testConnection: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  settingsApi: {
    get: mocks.getSettings,
    testConnection: mocks.testConnection,
  },
  systemApi: {
    getReadiness: mocks.getReadiness,
  },
}));

describe("ConnectionsTab deployment-owned provider configuration", () => {
  beforeEach(() => {
    mocks.getSettings.mockReset().mockResolvedValue({
      ok: true,
      data: {
        paperless_url: "http://paperless.internal",
        paperless_token_configured: true,
        mistral_api_key_configured: true,
        mistral_model: "mistral-ocr-latest",
        ollama_url: "http://ollama.internal",
        qdrant_url: "http://qdrant.internal",
      },
    });
    mocks.getReadiness.mockReset().mockResolvedValue({
      ok: true,
      data: {
        providers: {
          ollama: {
            model: "gpt-oss:120b",
            embeddingModel: "qwen3-embedding:8b",
          },
          qdrant: {
            collection: "paperless-documents",
            embeddingDimension: 4096,
          },
        },
      },
    });
    mocks.testConnection.mockReset().mockResolvedValue({
      ok: true,
      data: { status: "success", message: "Connected", details: null },
    });
  });

  it("renders non-editable Infisical values and tests all four services", async () => {
    render(<ConnectionsTab />);

    await waitFor(() => expect(mocks.testConnection).toHaveBeenCalledTimes(4));
    expect(screen.getByText("http://paperless.internal")).toBeInTheDocument();
    expect(screen.getByText("mistral-ocr-latest")).toBeInTheDocument();
    expect(screen.getByText("http://ollama.internal")).toBeInTheDocument();
    expect(screen.getByText("http://qdrant.internal")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Ollama gpt-oss:120b · embeddings qwen3-embedding:8b · Qdrant paperless-documents/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });
});
