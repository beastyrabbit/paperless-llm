import type { DocumentAgentRuntimeEvent } from "../PiDocumentAgent.js";
import type { PipelineStreamEvent } from "./types.js";

export const event = (e: Omit<PipelineStreamEvent, "timestamp">): PipelineStreamEvent => ({
  ...e,
  timestamp: new Date().toISOString(),
});

export const toPipelineAgentEvent = (
  docId: number,
  step: string,
  agentEvent: DocumentAgentRuntimeEvent,
): PipelineStreamEvent => {
  const toolName =
    typeof agentEvent.data["toolName"] === "string" ? agentEvent.data["toolName"] : undefined;
  const type =
    agentEvent.eventType === "response"
      ? "thinking"
      : agentEvent.eventType === "tool_call"
        ? "analyzing"
        : agentEvent.eventType === "tool_result"
          ? "confirming"
          : "error";
  return event({
    type,
    docId,
    step,
    data: agentEvent.data,
    message: toolName ? `${agentEvent.eventType}: ${toolName}` : agentEvent.eventType,
  });
};
