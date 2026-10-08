import { Deck, OrthographicView } from "@deck.gl/core";
import type { Device, Texture } from "@luma.gl/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Hud as HudState } from "./animation/frame.js";
import { Player } from "./animation/player.js";
import type { StoryStep } from "./animation/story.js";
import { createStory, PARALLEL_COLOR } from "./animation/story.js";
import nlcdUrl from "./assets/nlcd-albers-2500.png";
import { frameToLayers } from "./render/frame-to-layers.js";
import { bakedParallel, buildScene } from "./scene/build-scene.js";
import type { SlideFit } from "./scene/layout.js";
import { fitSlide, SLIDE_HEIGHT, SLIDE_WIDTH } from "./scene/layout.js";
import {
  composeTexture,
  createImageTexture,
  loadImage,
} from "./scene/texture.js";
import type { AppSettings } from "./settings.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { ControlBar } from "./ui/control-bar.js";
import { Hud } from "./ui/hud.js";
import { TuningPanel } from "./ui/tuning-panel.js";

/** Fill behind nodata pixels, so the whole image rectangle reads as a sheet. */
const SHEET_COLOR = "#232a36";

/** Width of the 49th parallel baked into the texture, in source pixels. */
const PARALLEL_WIDTH = 7;

/** How long the controls stay up after the pointer last moved, in ms. */
const CONTROLS_IDLE_MS = 2500;

/** Clicks this soon after a touch revealed the controls are ignored, in ms. */
const TOUCH_REVEAL_MS = 500;

/** localStorage key remembering whether descriptions are shown. */
const DESCRIPTIONS_KEY = "reprojection-explainer:descriptions";

const VIEW = new OrthographicView({ id: "slide", flipY: true });

const EMPTY_HUD: HudState = { counter: null, caption: null, labels: [] };

/** Whether descriptions were left on (the default) in this browser. */
function readDescriptions(): boolean {
  try {
    return window.localStorage.getItem(DESCRIPTIONS_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Remember the descriptions setting; best effort, as storage may be blocked. */
function writeDescriptions(descriptions: boolean): void {
  try {
    window.localStorage.setItem(DESCRIPTIONS_KEY, String(descriptions));
  } catch {
    // Storage unavailable (private window, blocked cookies): not remembered.
  }
}

function viewStateFor(fit: SlideFit) {
  return {
    target: [SLIDE_WIDTH / 2, SLIDE_HEIGHT / 2, 0] as [number, number, number],
    zoom: fit.zoom,
  };
}

function windowFit(): SlideFit {
  return fitSlide(window.innerWidth, window.innerHeight);
}

/** Keys a focused range input handles itself. */
const RANGE_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

/**
 * Whether a focused form control should handle this key itself. Everything
 * else goes to the presenter keys, so a control left focused by a click can't
 * swallow a presentation clicker's PageDown / PageUp.
 */
function controlHandlesKey(target: EventTarget | null, key: string): boolean {
  if (target instanceof HTMLSelectElement) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    if (target.type === "range") {
      return RANGE_KEYS.has(key);
    }
    if (target.type === "checkbox") {
      return key === " ";
    }
    return true;
  }
  if (target instanceof HTMLButtonElement) {
    return key === " " || key === "Enter";
  }
  return false;
}

/** Move focus out of the control bar, so hidden controls can't take keys. */
function blurControlBar(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest("[data-control-bar]")) {
    active.blur();
  }
}

/**
 * A full-screen, keyboard-driven explainer of how deck.gl-raster reprojects
 * a raster with a triangle mesh. See the README for the keys.
 */
export default function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deckRef = useRef<Deck<OrthographicView> | null>(null);
  const playerRef = useRef<Player | null>(null);
  const storyRef = useRef<StoryStep[] | null>(null);
  const textureRef = useRef<Texture | null>(null);

  const [device, setDevice] = useState<Device | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [fit, setFit] = useState(windowFit);
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [stepIndex, setStepIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);
  const [descriptions, setDescriptions] = useState(readDescriptions);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hoveringControlsRef = useRef(false);
  /** Shows the controls and restarts their idle timer. */
  const showControlsRef = useRef<(() => void) | null>(null);
  /** When a touch last revealed the hidden controls (performance.now()). */
  const touchRevealAtRef = useRef(Number.NEGATIVE_INFINITY);

  const { finalMaxError, flightStyle, flightMs, arcHeight, schedule, speed } =
    settings;
  const scene = useMemo(() => buildScene({ finalMaxError }), [finalMaxError]);
  const story = useMemo(
    () => createStory(scene, { flightStyle, flightMs, arcHeight, schedule }),
    [scene, flightStyle, flightMs, arcHeight, schedule],
  );
  const currentStep = story[stepIndex] ?? story[0]!;

  // One orthographic view over the 1920×1080 slide; no user interaction.
  // We own the canvas: when deck.gl creates one inside `parent`, a deck
  // finalized before its device is ready (React StrictMode's first mount)
  // leaves its canvas behind, pushing the real one down the page.
  useEffect(() => {
    const deck: Deck<OrthographicView> = new Deck({
      canvas: canvasRef.current!,
      views: VIEW,
      viewState: viewStateFor(windowFit()),
      controller: false,
      // Nothing on the canvas is interactive, so let touch devices pinch-zoom.
      touchAction: "manipulation",
      layers: [],
      onDeviceInitialized: (initialized) => {
        if (deckRef.current === deck) {
          setDevice(initialized);
        }
      },
      onError: (deckError) => {
        if (deckRef.current === deck) {
          setError(deckError.message);
        }
      },
    });
    deckRef.current = deck;
    if (import.meta.env.DEV) {
      // Debug handle for poking at the animation from the console.
      (window as unknown as { explainer: unknown }).explainer = {
        deck,
        player: () => playerRef.current,
        story: () => storyRef.current,
      };
    }
    return () => {
      deckRef.current = null;
      deck.finalize();
    };
  }, []);

  useEffect(() => {
    writeDescriptions(descriptions);
  }, [descriptions]);

  // Show the controls while the pointer moves; hide them when it rests, so
  // they stay off the projector while presenting with the keyboard.
  useEffect(() => {
    let timer = 0;
    let visible = true;
    const show = () => {
      visible = true;
      setControlsVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!hoveringControlsRef.current) {
          visible = false;
          setControlsVisible(false);
          blurControlBar();
        }
      }, CONTROLS_IDLE_MS);
    };
    const onPointerDown = (event: PointerEvent) => {
      // The tap that reveals hidden controls must not also press one.
      if (!visible && event.pointerType === "touch") {
        touchRevealAtRef.current = performance.now();
      }
      show();
    };
    showControlsRef.current = show;
    show();
    window.addEventListener("pointermove", show);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      showControlsRef.current = null;
      window.removeEventListener("pointermove", show);
      window.removeEventListener("pointerdown", onPointerDown);
      window.clearTimeout(timer);
    };
  }, []);

  // Keep the slide letterboxed in the root element. Measure the element, not
  // the window: on mobile, 100vh and window.innerHeight can differ.
  useEffect(() => {
    const root = rootRef.current!;
    const observer = new ResizeObserver(() => {
      setFit(fitSlide(root.clientWidth, root.clientHeight));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    deckRef.current?.setProps({ viewState: viewStateFor(fit) });
  }, [fit]);

  useEffect(() => {
    let cancelled = false;
    loadImage(nlcdUrl).then(
      (loaded) => {
        if (!cancelled) {
          setImage(loaded);
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setError(String(reason));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Upload the image, with the 49th parallel baked in, once the GPU is ready.
  useEffect(() => {
    if (!device || !image) {
      return;
    }
    let texture: Texture;
    try {
      const canvas = composeTexture(image, {
        background: SHEET_COLOR,
        lines: [
          {
            points: bakedParallel(),
            color: PARALLEL_COLOR,
            width: PARALLEL_WIDTH,
          },
        ],
      });
      texture = createImageTexture(device, canvas);
    } catch (reason) {
      setError(String(reason));
      return;
    }
    textureRef.current = texture;
    setError(null);
    return () => {
      if (textureRef.current === texture) {
        textureRef.current = null;
      }
      texture.destroy();
    };
  }, [device, image]);

  // A rebuilt story (after tuning) gets a new player on the same step. Steps
  // whose timing didn't change keep their place, so switching the flight
  // style doesn't restart the refinement replay; the others restart.
  useEffect(() => {
    const previous = playerRef.current;
    const previousStory = storyRef.current;
    let player = previous;
    if (!player || previousStory !== story) {
      player = new Player(story, () => performance.now());
      if (previous && previousStory) {
        const index = previous.stepIndex;
        player.jumpTo(index);
        if (previousStory[index]?.durationMs === story[index]?.durationMs) {
          player.seek(previous.timeInStep());
          if (!previous.paused) {
            player.resume();
          }
        }
      }
      playerRef.current = player;
      storyRef.current = story;
    }
    player.setSpeed(speed);
  }, [story, speed]);

  // Animation loop: evaluate the current step and hand deck.gl the layers.
  useEffect(() => {
    let frameId = 0;
    let last: {
      steps: StoryStep[];
      texture: Texture;
      index: number;
      time: number;
      paused: boolean;
    } | null = null;
    let lastHud = "";
    const tick = () => {
      frameId = requestAnimationFrame(tick);
      const deck = deckRef.current;
      const player = playerRef.current;
      const steps = storyRef.current;
      const texture = textureRef.current;
      if (!deck || !player || !steps || !texture) {
        return;
      }
      const index = player.stepIndex;
      const time = player.timeInStep();
      const isPaused = player.paused;
      if (
        last &&
        last.steps === steps &&
        last.texture === texture &&
        last.index === index &&
        last.time === time &&
        last.paused === isPaused
      ) {
        return;
      }
      last = { steps, texture, index, time, paused: isPaused };
      const step = steps[index]!;
      const frame = step.frame(time, { paused: isPaused });
      deck.setProps({ layers: frameToLayers(frame, texture) });
      const hudJson = JSON.stringify(frame.hud);
      if (hudJson !== lastHud) {
        lastHud = hudJson;
        setHud(frame.hud);
      }
      setStepIndex(index);
      setPaused(isPaused);
      setScrubPosition(step.scrubber?.positionAt(time) ?? 0);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Presenter keys. Clickers usually send PageDown / PageUp.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Leave browser shortcuts (reload, find, back, switch tab) alone.
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (controlHandlesKey(event.target, event.key)) {
        return;
      }
      const player = playerRef.current;
      if (!player) {
        return;
      }
      switch (event.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
          player.next();
          break;
        case "ArrowLeft":
        case "PageUp":
          player.previous();
          break;
        case "r":
        case "R":
          player.replay();
          break;
        case "f":
        case "F":
          setSettings((current) => ({
            ...current,
            flightStyle:
              current.flightStyle === "direct" ? "fly-then-snap" : "direct",
          }));
          break;
        case "h":
        case "H":
          setPanelOpen((open) => !open);
          break;
        case "d":
        case "D":
          setDescriptions((shown) => !shown);
          break;
        default:
          // Digit keys match the 1-based step numbers in the titles.
          if (!/^[1-9]$/.test(event.key)) {
            return;
          }
          player.jumpTo(Number(event.key) - 1);
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      ref={rootRef}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "#0d1117",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />
      <Hud
        fit={fit}
        layout={scene.layout}
        hud={hud}
        stepNumber={stepIndex + 1}
        title={currentStep.title}
        description={descriptions ? currentStep.description : null}
      >
        <ControlBar
          titles={story.map((step) => step.title)}
          stepIndex={stepIndex}
          visible={controlsVisible}
          descriptions={descriptions}
          paused={paused}
          scrubber={
            currentStep.scrubber
              ? {
                  count: currentStep.scrubber.count,
                  position: scrubPosition,
                  label: currentStep.scrubber.label(scrubPosition),
                }
              : null
          }
          onDescriptionsChange={setDescriptions}
          onPrevious={() => playerRef.current?.previous()}
          onNext={() => playerRef.current?.next()}
          onReplay={() => playerRef.current?.replay()}
          onResume={() => playerRef.current?.resume()}
          onJump={(index) => playerRef.current?.jumpTo(index)}
          onScrub={(position) => {
            const player = playerRef.current;
            const scrubber =
              storyRef.current?.[player?.stepIndex ?? -1]?.scrubber;
            if (player && scrubber) {
              player.seek(scrubber.timeAt(position));
            }
          }}
          onHoverChange={(hovering) => {
            hoveringControlsRef.current = hovering;
            if (!hovering) {
              // Restart the idle timer: hover can end without a pointermove,
              // e.g. when a slider drag is released off the bar.
              showControlsRef.current?.();
            }
          }}
          shouldIgnoreClick={() =>
            performance.now() - touchRevealAtRef.current < TOUCH_REVEAL_MS
          }
        />
      </Hud>
      {error ? (
        <div
          style={{
            position: "absolute",
            left: 20,
            bottom: 20,
            color: "#ff7b72",
            fontSize: 16,
          }}
        >
          {error}
        </div>
      ) : null}
      {panelOpen ? (
        <TuningPanel settings={settings} onChange={setSettings} />
      ) : null}
    </div>
  );
}
