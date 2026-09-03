export interface SerialExecutor {
  enqueue(task: () => Promise<void>): void;
  idle(): Promise<void>;
}

/**
 * Runs async tasks strictly one-at-a-time in submission order.
 * A rejected task does not poison the queue; later tasks can still run.
 */
export function createSerialExecutor(onError?: (error: unknown) => void): SerialExecutor {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue(task) {
      tail = tail.then(task, task).catch((error) => {
        try { onError?.(error); } catch { /* do not poison the queue */ }
      });
    },
    idle() { return tail; }
  };
}

/**
 * Coalesces concurrent work for the same key inside one Worker isolate.
 * This is intentionally isolate-local: it prevents the common thundering-herd
 * case without pretending to provide a globally atomic distributed lock.
 */
export function createSingleFlight<K, V>(): (key: K, task: () => Promise<V>) => Promise<V> {
  const flights = new Map<K, Promise<V>>();
  return (key, task) => {
    const existing = flights.get(key);
    if (existing) return existing;
    const promise = Promise.resolve().then(task).finally(() => {
      if (flights.get(key) === promise) flights.delete(key);
    });
    flights.set(key, promise);
    return promise;
  };
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message = "operation timed out"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}
