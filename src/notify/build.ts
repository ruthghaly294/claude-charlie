import type { NotifyConfig } from "@/discovery/config";
import { createConsoleNotifier } from "./console";
import { createNtfyNotifier } from "./ntfy";
import type { Notifier } from "./notifier";

const FACTORIES: Record<string, (env: Record<string, string | undefined>) => Notifier> = {
  console: () => createConsoleNotifier(),
  ntfy: (env) => createNtfyNotifier(env),
};

/** Build the configured Notifier list for notify.channels, in order. Unknown channel names are ignored. */
export function buildNotifiers(
  notify: NotifyConfig,
  env: Record<string, string | undefined>,
): Notifier[] {
  return notify.channels
    .map((channel) => FACTORIES[channel]?.(env))
    .filter((n): n is Notifier => n !== undefined);
}
