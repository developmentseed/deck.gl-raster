import { beforeEach, describe, expect, it } from "vitest";
import { Player } from "../src/animation/player.js";

let clock = 0;
const now = () => clock;
const STEPS = [{ durationMs: 0 }, { durationMs: 1000 }, { durationMs: 500 }];

describe("Player", () => {
  beforeEach(() => {
    clock = 0;
  });

  it("starts at step 0", () => {
    const player = new Player(STEPS, now);
    expect(player.stepIndex).toBe(0);
    expect(player.isAnimating()).toBe(false);
  });

  it("advances when the current step has finished", () => {
    const player = new Player(STEPS, now);
    player.next();
    expect(player.stepIndex).toBe(1);
    expect(player.timeInStep()).toBe(0);
    clock = 400;
    expect(player.timeInStep()).toBe(400);
    expect(player.isAnimating()).toBe(true);
  });

  it("finishes a running animation before advancing", () => {
    const player = new Player(STEPS, now);
    player.next();
    clock = 100;
    player.next();
    expect(player.stepIndex).toBe(1);
    expect(player.timeInStep()).toBe(1000);
    expect(player.isAnimating()).toBe(false);
    player.next();
    expect(player.stepIndex).toBe(2);
  });

  it("never runs past the last step, however often next() is pressed", () => {
    const player = new Player(STEPS, now);
    for (let i = 0; i < 20; i++) {
      player.next();
    }
    expect(player.stepIndex).toBe(2);
    expect(player.timeInStep()).toBe(500);
  });

  it("goes back to the previous step's end, and stays at step 0", () => {
    const player = new Player(STEPS, now);
    player.jumpTo(2);
    player.previous();
    expect(player.stepIndex).toBe(1);
    expect(player.timeInStep()).toBe(1000);
    player.previous();
    player.previous();
    expect(player.stepIndex).toBe(0);
  });

  it("replays and jumps from the start of a step", () => {
    const player = new Player(STEPS, now);
    player.jumpTo(1);
    clock = 600;
    player.replay();
    expect(player.timeInStep()).toBe(0);
    player.jumpTo(99);
    expect(player.stepIndex).toBe(2);
    player.jumpTo(-3);
    expect(player.stepIndex).toBe(0);
  });

  it("plays faster at a higher speed without jumping", () => {
    const player = new Player(STEPS, now);
    player.jumpTo(1);
    clock = 100;
    player.setSpeed(2);
    expect(player.timeInStep()).toBe(100);
    clock = 200;
    expect(player.timeInStep()).toBe(300);
  });

  it("advances on the next press after finishing, despite rounding", () => {
    // These values leave (now - startedAt) * speed a hair under the step's
    // length after finish(), without a tolerance.
    clock = 98765.4321;
    const player = new Player(
      [...STEPS.slice(0, 1), { durationMs: 2350 }, STEPS[2]!],
      now,
    );
    player.jumpTo(1);
    clock += 17.3;
    player.setSpeed(0.75);
    player.next();
    expect(player.isAnimating()).toBe(false);
    player.next();
    expect(player.stepIndex).toBe(2);
  });

  it("rejects an empty step list", () => {
    expect(() => new Player([], now)).toThrow();
  });
});

describe("Player.seek", () => {
  beforeEach(() => {
    clock = 0;
  });

  it("pauses at the given time", () => {
    const player = new Player(STEPS, now);
    player.jumpTo(1);
    player.seek(400);
    expect(player.paused).toBe(true);
    expect(player.timeInStep()).toBe(400);
    clock = 5000;
    expect(player.timeInStep()).toBe(400);
    expect(player.isAnimating()).toBe(true);
  });

  it("clamps to the step's length", () => {
    const player = new Player(STEPS, now);
    player.jumpTo(1);
    player.seek(-10);
    expect(player.timeInStep()).toBe(0);
    player.seek(99999);
    expect(player.timeInStep()).toBe(1000);
  });

  it("resumes from where it was paused", () => {
    const player = new Player(STEPS, now);
    player.jumpTo(1);
    player.seek(400);
    clock = 1000;
    player.resume();
    expect(player.paused).toBe(false);
    clock = 1100;
    expect(player.timeInStep()).toBe(500);
  });

  it("is unpaused by next, previous, replay and jumpTo", () => {
    const player = new Player(STEPS, now);
    player.jumpTo(1);
    player.seek(400);
    player.next();
    expect(player.paused).toBe(false);
    expect(player.timeInStep()).toBe(1000);

    player.seek(100);
    player.replay();
    expect(player.paused).toBe(false);

    player.seek(100);
    player.previous();
    expect(player.paused).toBe(false);

    player.jumpTo(1);
    player.seek(100);
    player.jumpTo(2);
    expect(player.paused).toBe(false);
  });

  it("keeps a paused time when the speed changes", () => {
    const player = new Player(STEPS, now);
    player.jumpTo(1);
    player.seek(400);
    player.setSpeed(2);
    clock = 300;
    expect(player.timeInStep()).toBe(400);
  });
});
