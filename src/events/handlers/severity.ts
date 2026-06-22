import type { NotifyConfig, NotifySeverity } from "@/discovery/config";
import type { NotifyPriority } from "@/notify/notifier";

const SEVERITY_TO_PRIORITY: Record<NotifySeverity, NotifyPriority> = {
  low: "low",
  medium: "default",
  high: "high",
};

/** Looks up the configured severity for an event type and maps it to a ntfy priority. */
export function priorityFor(notify: NotifyConfig, type: string): NotifyPriority {
  const severity = notify.events[type] ?? "low";
  return SEVERITY_TO_PRIORITY[severity];
}
