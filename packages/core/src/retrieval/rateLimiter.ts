const DEFAULT_MIN_INTERVAL_MS = 1_000;

let defaultInterval = DEFAULT_MIN_INTERVAL_MS;
const serviceIntervals = new Map<string, number>();
const chains = new Map<string, Promise<void>>();
const lastCallAt = new Map<string, number>();

export function throttle(service = 'default'): Promise<void> {
  const interval = serviceIntervals.get(service) ?? defaultInterval;
  const previous = (chains.get(service) ?? Promise.resolve()).catch(
    () => undefined,
  );
  const next = previous.then(async () => {
    const gap = (lastCallAt.get(service) ?? 0) + interval - Date.now();
    if (gap > 0) await delay(gap);
    lastCallAt.set(service, Date.now());
  });
  chains.set(service, next);
  return next;
}

export function setMinRequestInterval(ms: number): void {
  defaultInterval = Math.max(0, ms);
}

export function setServiceInterval(service: string, ms: number): void {
  serviceIntervals.set(service, Math.max(0, ms));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}