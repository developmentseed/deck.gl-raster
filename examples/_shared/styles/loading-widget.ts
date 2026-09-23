import type { DeckWidgetTheme, LoadingWidgetProps } from "@deck.gl/widgets";

/**
 * deck.gl widget theme variables matching the shared Chakra `ControlPanel`:
 * white card, `lg` corner radius, soft shadow, 20px corner offset.
 */
const theme: DeckWidgetTheme = {
  "--widget-margin": "20px",
  "--button-size": "36px",
  "--button-background": "#fff",
  "--button-corner-radius": "8px",
  "--button-shadow": "0 2px 8px rgba(0, 0, 0, 0.1)",
  "--button-icon-idle": "#52525b",
};

/**
 * Props for deck.gl's `LoadingWidget`, themed to match the example UI.
 *
 * Pass `widgets={[new LoadingWidget(loadingWidgetProps)]}` to `DeckGlOverlay`
 * and import `@deck.gl/widgets/stylesheet.css` in the app. Placed top-right
 * because `ControlPanel` defaults to top-left.
 */
export const loadingWidgetProps: LoadingWidgetProps = {
  placement: "top-right",
  label: "Loading tiles…",
  // `WidgetProps.style` is typed as `CSSStyleDeclaration`, which has no `--*`
  // keys; deck.gl applies those through `style.setProperty`.
  style: theme as Partial<CSSStyleDeclaration>,
};
