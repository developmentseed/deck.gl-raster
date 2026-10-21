/** A step the {@link Player} plays: only its length matters here. */
export type PlayerStep = { durationMs: number };

/**
 * Slack when comparing elapsed time with a step's length, in ms. After
 * `finish()`, `(now - startedAt) * speed` can land a rounding error short of
 * the length, which would make the next press finish the step again.
 */
const EPSILON_MS = 1e-6;

/**
 * The presenter's remote: which step is showing and how far into it.
 * Time comes from an injected clock so the logic is testable.
 */
export class Player {
  private index = 0;
  private startedAt: number;
  private speed = 1;
  /** Time into the step while paused, in ms; null while playing. */
  private pausedAt: number | null = null;

  /**
   * @param steps The steps to play, in order. Must not be empty.
   * @param now Clock in ms, e.g. `() => performance.now()` (an unbound
   *   `performance.now` throws "Illegal invocation" when called).
   */
  constructor(
    private readonly steps: readonly PlayerStep[],
    private readonly now: () => number,
  ) {
    if (steps.length === 0) {
      throw new Error("Player needs at least one step");
    }
    this.startedAt = now();
  }

  /** Index of the step showing. */
  get stepIndex(): number {
    return this.index;
  }

  /** True while paused by {@link Player.seek}. */
  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** Time into the current step in ms, clamped to the step's length. */
  timeInStep(): number {
    return Math.min(this.elapsed(), this.duration());
  }

  /** True while the current step has not reached its end. */
  isAnimating(): boolean {
    return this.elapsed() < this.duration() - EPSILON_MS;
  }

  /** Finish the running animation, or go to the next step if it has finished. */
  next(): void {
    if (this.isAnimating()) {
      this.finish();
      return;
    }
    this.pausedAt = null;
    if (this.index < this.steps.length - 1) {
      this.index++;
      this.startedAt = this.now();
    }
  }

  /** Show the previous step in its finished state (step 0 stays at step 0). */
  previous(): void {
    this.index = Math.max(0, this.index - 1);
    this.finish();
  }

  /** Restart the current step. */
  replay(): void {
    this.pausedAt = null;
    this.startedAt = this.now();
  }

  /** Start step `index` (clamped to the valid range) from its beginning. */
  jumpTo(index: number): void {
    this.index = Math.min(
      Math.max(0, Math.round(index)),
      this.steps.length - 1,
    );
    this.pausedAt = null;
    this.startedAt = this.now();
  }

  /** Pause the current step at `timeMs` (clamped to the step's length). */
  seek(timeMs: number): void {
    this.pausedAt = Math.min(Math.max(0, timeMs), this.duration());
  }

  /** Continue playing from where {@link Player.seek} paused. */
  resume(): void {
    if (this.pausedAt === null) {
      return;
    }
    this.startedAt = this.now() - this.pausedAt / this.speed;
    this.pausedAt = null;
  }

  /** Set the playback speed (1 = normal) without jumping in time. */
  setSpeed(speed: number): void {
    const time = this.elapsed();
    this.speed = speed;
    this.startedAt = this.now() - time / speed;
  }

  private elapsed(): number {
    if (this.pausedAt !== null) {
      return this.pausedAt;
    }
    return (this.now() - this.startedAt) * this.speed;
  }

  private duration(): number {
    return this.steps[this.index]!.durationMs;
  }

  private finish(): void {
    this.pausedAt = null;
    this.startedAt = this.now() - this.duration() / this.speed;
  }
}
