import { fetchWithRetry } from "@/discovery/fetchWithRetry";
import type { Notifier } from "./notifier";

export function createNtfyNotifier(
  env: Record<string, string | undefined>,
  opts: { fetchImpl?: typeof fetch; baseUrl?: string; retries?: number } = {},
): Notifier {
  const topic = env.NTFY_TOPIC;
  const baseUrl = opts.baseUrl ?? "https://ntfy.sh";

  return {
    name: "ntfy",
    configured: !!topic,
    async send(message) {
      if (!topic) throw new Error("ntfy notifier is not configured (NTFY_TOPIC not set)");

      const headers: Record<string, string> = { Title: message.title };
      if (message.priority) headers["Priority"] = message.priority;
      if (message.url) headers["Click"] = message.url;

      const res = await fetchWithRetry(
        `${baseUrl}/${topic}`,
        { method: "POST", body: message.body, headers },
        { fetchImpl: opts.fetchImpl, retries: opts.retries },
      );

      if (!res.ok) throw new Error(`ntfy: HTTP ${res.status}`);
    },
  };
}
