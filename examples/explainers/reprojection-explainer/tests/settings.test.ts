import { describe, expect, it } from "vitest";
import { settingsFromUrl, urlWithSettings } from "../src/settings.js";

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
});
