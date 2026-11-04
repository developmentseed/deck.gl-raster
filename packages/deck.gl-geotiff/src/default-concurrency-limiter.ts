import { PerOriginSemaphore } from "@developmentseed/geotiff";

/**
 * Shared default concurrency limiter for {@link COGSource.open},
 * {@link MultiCOGSource.open} and {@link MosaicLayer}, when they aren't given
 * a `concurrencyLimiter`. A single module-level
 * `PerOriginSemaphore({ maxRequests: 6 })` so two layers fetching from the
 * same origin (e.g. the same S3 bucket) share *one* HTTP/1.1 connection
 * pool. The cap matches Chrome's default per-origin HTTP/1.1 limit.
 */
export const DEFAULT_CONCURRENCY_LIMITER = new PerOriginSemaphore({
  maxRequests: 6,
});
