import type { NotifyConfig } from "@/discovery/config";
import type { EventHandlers } from "../bus";
import { priorityFor } from "./severity";

/**
 * decode.insight_created, decode.execution_ready, discovery.run_failed, and
 * source.breaker_opened → a one-line notification with a priority derived
 * from notify.events severity.
 */
export function createDecodeEventHandlers(notify: NotifyConfig): EventHandlers {
  return {
    "decode.insight_created": (event) => {
      const payload = event.payload as { cluster: string; trend: string };
      return {
        title: `New insight: ${payload.cluster}`,
        body: payload.trend,
        priority: priorityFor(notify, event.type),
      };
    },

    "decode.execution_ready": (event) => {
      const payload = event.payload as { title: string; lane: string };
      return {
        title: "Ready to execute",
        body: `[${payload.lane}] ${payload.title}`,
        priority: priorityFor(notify, event.type),
      };
    },

    "discovery.run_failed": (event) => {
      const payload = event.payload as { error: string };
      return {
        title: "Discovery run failed",
        body: payload.error,
        priority: priorityFor(notify, event.type),
      };
    },

    "source.breaker_opened": (event) => {
      const payload = event.payload as { source: string };
      return {
        title: "Source breaker opened",
        body: `${payload.source} is now skipped (circuit open)`,
        priority: priorityFor(notify, event.type),
      };
    },
  };
}
