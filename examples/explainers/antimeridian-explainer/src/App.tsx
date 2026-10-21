import type { Layer } from "@deck.gl/core";
import { Deck, OrthographicView } from "@deck.gl/core";
import type { Device } from "@luma.gl/core";
import { useEffect, useRef, useState } from "react";
import type { Frame, Hud as HudState } from "./animation/frame.js";
import { Player } from "./animation/player.js";
import type { StoryStep } from "./animation/story.js";
import { createStory } from "./animation/story.js";
import { frameToLayers, layerFilter } from "./render/frame-to-layers.js";
import { createImageTexture, imageCanvas } from "./render/texture.js";
import type { SlideFit } from "./scene/layout.js";
import {
  fitSlide,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  viewFor,
} from "./scene/layout.js";
import type { LoadProgress, SourceImage } from "./scene/load.js";
import { loadImage } from "./scene/load.js";
import type { MeshScene } from "./scene/mesh.js";
import { buildMeshScene } from "./scene/mesh.js";
import { makeProjection } from "./scene/projection.js";
import { ControlBar } from "./ui/control-bar.js";
import { Hud } from "./ui/hud.js";
import { Loading } from "./ui/loading.js";
import { SidePanel } from "./ui/side-panel.js";

/** How long the controls stay up after the pointer last moved, in ms. */
const CONTROLS_IDLE_MS = 2500;

/** Clicks this soon after a touch revealed the controls are ignored, in ms. */
const TOUCH_REVEAL_MS = 500;

/** localStorage key remembering whether descriptions are shown. */
const DESCRIPTIONS_KEY = "antimeridian-explainer:descriptions";

/** The whole slide, in slide units (y down). */
const SLIDE_VIEW = new OrthographicView({ id: "slide", flipY: true });

/** Each pixel of the image becomes this many texels, to keep it crisp. */
const TEXTURE_SCALE = 24;

const EMPTY_HUD: HudState = { caption: null, labels: [] };

/** What the app needs before the first step can draw. */
type Ready = {
  image: SourceImage;
  scene: MeshScene;
  story: StoryStep[];
  layers: (frame: Frame) => Layer[];
};

/** Load everything the story draws. */
async function startup(
  device: Device,
  onProgress: (progress: LoadProgress) => void,
): Promise<Ready> {
  const image = await loadImage({ onProgress });
  const projection = await makeProjection(image);
  const scene = buildMeshScene(projection, {
    width: image.width,
    height: image.height,
  });
  const texture = createImageTexture(device, imageCanvas(image, TEXTURE_SCALE));
  return {
    image,
    scene,
    story: createStory(scene, image),
    layers: (frame) => frameToLayers(frame, { texture }),
  };
}

/**
 * deck.gl views for a frame: the slide, plus one view per map camera, placed
 * in the window. North is up in the map views.
 */
function viewsFor(frame: Frame, fit: SlideFit) {
  const views: OrthographicView[] = [SLIDE_VIEW];
  const viewState: Record<
    string,
    { target: [number, number, number]; zoom: number }
  > = { slide: viewStateFor(fit) };
  for (const [id, camera] of Object.entries(frame.cameras)) {
    if (!camera) {
      continue;
    }
    const { x, y, width, height, target, zoom } = viewFor(camera, fit);
    views.push(new OrthographicView({ id, x, y, width, height, flipY: false }));
    viewState[id] = { target, zoom };
  }
  return { views, viewState };
}

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
 * A full-screen, keyboard-driven explainer of how deck.gl-raster meshes an
 * image that crosses the antimeridian. See the README for the keys.
 */
export default function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deckRef = useRef<Deck<OrthographicView[]> | null>(null);
  const fitRef = useRef<SlideFit>(windowFit());
  const playerRef = useRef<Player | null>(null);
  const readyRef = useRef<Ready | null>(null);

  const [device, setDevice] = useState<Device | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [fit, setFit] = useState(windowFit);
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [stepIndex, setStepIndex] = useState(0);
  const [descriptions, setDescriptions] = useState(readDescriptions);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hoveringControlsRef = useRef(false);
  /** Shows the controls and restarts their idle timer. */
  const showControlsRef = useRef<(() => void) | null>(null);
  /** When a touch last revealed the hidden controls (performance.now()). */
  const touchRevealAtRef = useRef(Number.NEGATIVE_INFINITY);

  // One orthographic view over the 1920 x 1080 slide; no user interaction.
  // We own the canvas: when deck.gl creates one inside `parent`, a deck
  // finalized before its device is ready (React StrictMode's first mount)
  // leaves its canvas behind, pushing the real one down the page.
  useEffect(() => {
    const deck: Deck<OrthographicView[]> = new Deck({
      canvas: canvasRef.current!,
      views: [SLIDE_VIEW],
      viewState: { slide: viewStateFor(windowFit()) },
      layerFilter,
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
        ready: () => readyRef.current,
        scene: () => readyRef.current?.scene,
      };
    }
    return () => {
      deckRef.current = null;
      deck.finalize();
    };
  }, []);

  // Load everything once the GPU is ready.
  useEffect(() => {
    if (!device) {
      return;
    }
    let cancelled = false;
    const onProgress = (progress: LoadProgress) => {
      if (!cancelled) {
        setProgress(progress);
      }
    };
    startup(device, onProgress).then(
      (loaded) => {
        if (!cancelled) {
          readyRef.current = loaded;
          playerRef.current = new Player(loaded.story, () => performance.now());
          setReady(loaded);
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [device]);

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
    fitRef.current = fit;
  }, [fit]);

  // Animation loop: evaluate the current step and hand deck.gl the layers.
  useEffect(() => {
    let frameId = 0;
    let last: {
      ready: Ready;
      index: number;
      time: number;
      fit: SlideFit;
    } | null = null;
    let lastHud = "";
    let lastViews = "";
    const tick = () => {
      frameId = requestAnimationFrame(tick);
      const deck = deckRef.current;
      const player = playerRef.current;
      const current = readyRef.current;
      if (!deck || !player || !current) {
        return;
      }
      const index = player.stepIndex;
      const time = player.timeInStep();
      const fit = fitRef.current;
      if (
        last &&
        last.ready === current &&
        last.index === index &&
        last.time === time &&
        last.fit === fit
      ) {
        return;
      }
      last = { ready: current, index, time, fit };
      const frame = current.story[index]!.frame(time);
      // Rebuild the views only when a camera or the window changes.
      const viewsKey = JSON.stringify([frame.cameras, fit]);
      if (viewsKey !== lastViews) {
        lastViews = viewsKey;
        deck.setProps(viewsFor(frame, fit));
      }
      deck.setProps({ layers: current.layers(frame) });
      const hudJson = JSON.stringify(frame.hud);
      if (hudJson !== lastHud) {
        lastHud = hudJson;
        setHud(frame.hud);
      }
      setStepIndex(index);
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
      switch (event.key) {
        case "p":
        case "P":
          setPanelOpen((open) => !open);
          event.preventDefault();
          return;
        case "d":
        case "D":
          setDescriptions((shown) => !shown);
          event.preventDefault();
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

  const story = ready?.story ?? [];
  const currentStep = story[stepIndex];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        overflow: "hidden",
        background: "#0d1117",
      }}
    >
      <SidePanel open={panelOpen} onOpenChange={setPanelOpen} />
      {/* The stage: the slide is letterboxed into whatever the panel leaves. */}
      <div
        ref={rootRef}
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
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
        {currentStep ? (
          <Hud
            fit={fit}
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
              paused={false}
              scrubber={null}
              onDescriptionsChange={setDescriptions}
              onPrevious={() => playerRef.current?.previous()}
              onNext={() => playerRef.current?.next()}
              onReplay={() => playerRef.current?.replay()}
              onResume={() => playerRef.current?.resume()}
              onJump={(index) => playerRef.current?.jumpTo(index)}
              onScrub={() => {}}
              onHoverChange={(hovering) => {
                hoveringControlsRef.current = hovering;
                if (!hovering) {
                  // Restart the idle timer: hover can end without a pointermove.
                  showControlsRef.current?.();
                }
              }}
              shouldIgnoreClick={() =>
                performance.now() - touchRevealAtRef.current < TOUCH_REVEAL_MS
              }
            />
          </Hud>
        ) : null}
        {!ready || error ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 40,
              textAlign: "center",
              color: error ? "#ff7b72" : "#8b949e",
              fontSize: 20,
            }}
          >
            {error ?? <Loading progress={progress} />}
          </div>
        ) : null}
      </div>
    </div>
  );
}
