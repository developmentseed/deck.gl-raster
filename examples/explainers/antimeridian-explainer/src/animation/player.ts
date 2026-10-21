/** A step the {@link Player} plays: its length, and where it holds. */
export type PlayerStep = {
  durationMs: number;
  /**
   * Times into the step, in ms, where playback holds until the presenter
   * presses next: the step's beats. Without stops, a step plays through.
   */
  stops?: readonly number[];
};

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
  /** Where the running beat ends: the next stop, or the step's end. */
  private holdAt: number;

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
    this.holdAt = this.holds()[0]!;
  }

  /** Index of the step showing. */
  get stepIndex(): number {
    return this.index;
  }

  /** Which beat of the current step is showing, of how many. */
  get beat(): { index: number; count: number } {
    const holds = this.holds();
    return { index: holds.indexOf(this.holdAt), count: holds.length };
  }

  /** True while paused by {@link Player.seek}. */
  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** Time into the current step in ms, held at the running beat's end. */
  timeInStep(): number {
    return Math.min(this.elapsed(), this.holdAt);
  }

  /** True while the running beat has not reached its end. */
  isAnimating(): boolean {
    return this.elapsed() < this.holdAt - EPSILON_MS;
  }

  /**
   * Finish the running beat; or play the step's next beat; or, at the step's
   * end, go to the next step.
   */
  next(): void {
    if (this.isAnimating()) {
      this.finish();
      return;
    }
    this.pausedAt = null;
    const holds = this.holds();
    const later = holds.find((hold) => hold > this.holdAt + EPSILON_MS);
    if (later !== undefined) {
      this.startedAt = this.now() - this.holdAt / this.speed;
      this.holdAt = later;
      return;
    }
    if (this.index < this.steps.length - 1) {
      this.index++;
      this.startedAt = this.now();
      this.holdAt = this.holds()[0]!;
    }
  }

  /**
   * Show the previous beat finished; before the first beat, the previous step
   * finished (step 0 stays at step 0).
   */
  previous(): void {
    const earlier = this.holds().filter(
      (hold) => hold < this.holdAt - EPSILON_MS,
    );
    if (earlier.length > 0) {
      this.holdAt = earlier[earlier.length - 1]!;
      this.finish();
      return;
    }
    this.index = Math.max(0, this.index - 1);
    this.holdAt = this.duration();
    this.finish();
  }

  /** Restart the current step. */
  replay(): void {
    this.pausedAt = null;
    this.startedAt = this.now();
    this.holdAt = this.holds()[0]!;
  }

  /** Start step `index` (clamped to the valid range) from its beginning. */
  jumpTo(index: number): void {
    this.index = Math.min(
      Math.max(0, Math.round(index)),
      this.steps.length - 1,
    );
    this.pausedAt = null;
    this.startedAt = this.now();
    this.holdAt = this.holds()[0]!;
  }

  /** Pause the current step at `timeMs` (clamped to the step's length). */
  seek(timeMs: number): void {
    const time = Math.min(Math.max(0, timeMs), this.duration());
    this.pausedAt = time;
    this.holdAt =
      this.holds().find((hold) => hold >= time - EPSILON_MS) ?? this.duration();
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

  /** Where the current step holds: its stops inside it, then its end. */
  private holds(): number[] {
    const duration = this.duration();
    const stops = (this.steps[this.index]!.stops ?? [])
      .filter((stop) => stop > 0 && stop < duration)
      .sort((a, b) => a - b);
    return [...stops, duration];
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
    this.startedAt = this.now() - this.holdAt / this.speed;
  }
}
