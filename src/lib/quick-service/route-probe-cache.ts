/**
 * Short-lived caches for the quick-service page's probes (A6-10): every page
 * load used to scan the listening ports and ask dockerd for its status again.
 * Kept out of the route module because Next.js route files may only export
 * HTTP handlers (the test reset below would fail the route type check).
 */
import type { getDockerEnvironmentStatusFor } from "@/lib/quick-service/docker-cli";

type ProbeCache<T> = Map<string, { at: number; value: Promise<T> }>;

export const usedPortsCache: ProbeCache<number[]> = new Map();
export const dockerStatusCache: ProbeCache<Awaited<ReturnType<typeof getDockerEnvironmentStatusFor>>> = new Map();

/** Test hook: forget cached probes between cases. */
export function resetQuickServiceRouteCachesForTests() {
	usedPortsCache.clear();
	dockerStatusCache.clear();
}

export function cachedProbe<T>(cache: ProbeCache<T>, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
	const now = Date.now();
	const hit = cache.get(key);
	if (hit && now - hit.at < ttlMs) return hit.value;
	// Promise.resolve().then: a synchronous loader (test mocks) must not break the cache.
	const value = Promise.resolve().then(load);
	cache.set(key, { at: now, value });
	value.catch(() => cache.delete(key));
	if (cache.size > 200) cache.delete(cache.keys().next().value!);
	return value;
}
