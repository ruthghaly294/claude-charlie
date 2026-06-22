import type { Notifier } from "./notifier";

export function createConsoleNotifier(opts: { log?: (line: string) => void } = {}): Notifier {
  const log = opts.log ?? ((line: string) => console.log(line));
  return {
    name: "console",
    configured: true,
    async send(message) {
      const lines = [`[notify] ${message.title}`, message.body];
      if (message.url) lines.push(message.url);
      log(lines.join("\n"));
    },
  };
}
