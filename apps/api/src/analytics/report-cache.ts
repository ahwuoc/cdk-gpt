/** Short-lived, per-process report cache. Financial writes never read from it. */
export class ReportCache<T> {
  private readonly entries = new Map<string, { promise: Promise<T>; expiresAt: number; pending: boolean }>();

  constructor(private readonly ttlMs = 15_000) {}

  get(key: string, load: () => Promise<T>, refresh = false): Promise<T> {
    const cached = this.entries.get(key);
    if (!refresh && cached && (cached.pending || cached.expiresAt > Date.now())) return cached.promise;
    this.entries.delete(key);
    // Bound both completed results and tracked in-flight requests for arbitrary report filters.
    while (this.entries.size >= 32) this.entries.delete(this.entries.keys().next().value!);
    const entry = { promise: Promise.resolve().then(load), expiresAt: 0, pending: true };
    entry.promise = entry.promise.then((value) => {
      entry.pending = false;
      entry.expiresAt = Date.now() + this.ttlMs;
      return value;
    }, (error: unknown) => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    return entry.promise;
  }
}
