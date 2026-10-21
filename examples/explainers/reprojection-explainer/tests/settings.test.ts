import { describe, expect, it } from "vitest";
import {
  settingsFromUrl,
  toggleErrorSpace,
  urlWithSettings,
} from "../src/settings.js";

describe("settings in the URL", () => {
  it("defaults to the NLCD scenario at its default tolerance", () => {
    const settings = settingsFromUrl("");
    expect(settings.scenario).toBe("nlcd");
    expect(settings.finalMaxError).toBe(4);
  });

  it("picks the scenario named by ?scenario=, at its default tolerance", () => {
    const settings = settingsFromUrl("?scenario=arctic");
    expect(settings.scenario).toBe("arctic");
    expect(settings.finalMaxError).toBe(8);
  });

  it("ignores an unknown scenario", () => {
    expect(settingsFromUrl("?scenario=moon").scenario).toBe("nlcd");
  });

  it("writes the scenario into the URL, leaving the default out", () => {
    const arctic = settingsFromUrl("?scenario=arctic");
    expect(urlWithSettings("https://example.com/explainer/?x=1", arctic)).toBe(
      "https://example.com/explainer/?x=1&scenario=arctic",
    );
    expect(
      urlWithSettings(
        "https://example.com/explainer/?scenario=arctic",
        settingsFromUrl(""),
      ),
    ).toBe("https://example.com/explainer/");
  });

  it("measures error in input pixels by default", () => {
    expect(settingsFromUrl("").errorSpace).toBe("input");
  });

  it("measures error in output pixels with ?metric=output", () => {
    expect(settingsFromUrl("?metric=output").errorSpace).toBe("output");
  });

  it("ignores an unknown metric", () => {
    expect(settingsFromUrl("?metric=meters").errorSpace).toBe("input");
  });

  it("writes the metric into the URL, leaving the default out", () => {
    const target = settingsFromUrl("?scenario=arctic&metric=output");
    expect(urlWithSettings("https://example.com/explainer/", target)).toBe(
      "https://example.com/explainer/?scenario=arctic&metric=output",
    );
    expect(
      urlWithSettings(
        "https://example.com/explainer/?metric=output",
        settingsFromUrl(""),
      ),
    ).toBe("https://example.com/explainer/");
  });
});

describe("toggleErrorSpace", () => {
  it("flips between input and output pixels, keeping other settings", () => {
    const source = settingsFromUrl("?scenario=arctic");
    const target = toggleErrorSpace(source);
    expect(target).toEqual({ ...source, errorSpace: "output" });
    expect(toggleErrorSpace(target)).toEqual(source);
  });
});
