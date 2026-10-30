const londonHour = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "numeric",
  hourCycle: "h23",
});
// The user asked for no routine scanning from 11pm to 7am UK time.
export function quietHours(now: Date): boolean {
  const hour = Number(londonHour.format(now));
  return hour >= 23 || hour < 7;
}
