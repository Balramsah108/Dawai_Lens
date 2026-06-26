// In-memory cache adapter
// TODO: Replace with Redis when ready for production

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Unix timestamp in ms
}

const store = new Map<string, CacheEntry<unknown>>();

// Set a value with TTL in seconds
export const cacheSet = <T>(key: string, value: T, ttlSeconds: number): void => {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
};

// Get a value — returns null if missing or expired
export const cacheGet = <T>(key: string): T | null => {
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }

  return entry.value as T;
};

// Delete a specific key
export const cacheDel = (key: string): void => {
  store.delete(key);
};

// Check if a key exists and is not expired
export const cacheHas = (key: string): boolean => {
  return cacheGet(key) !== null;
};

// Increment a counter — creates it at 1 if it doesn't exist
export const cacheIncr = (key: string, ttlSeconds: number): number => {
  const current = cacheGet<number>(key) ?? 0;
  const next = current + 1;
  cacheSet(key, next, ttlSeconds);
  return next;
};
