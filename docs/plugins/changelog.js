const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const FRONTMATTER = `\
---
sidebar_position: 100
sidebar_label: Changelog
slug: /changelog
---

`;

/**
 * Docusaurus plugin that copies the root CHANGELOG.md into the guides
 * directory with Docusaurus frontmatter prepended. This keeps the changelog
 * on the docs site without requiring manual sync.
 */
module.exports = function changelogPlugin(_context, _options) {
  return {
    name: "changelog",
    async loadContent() {
      const src = resolve(__dirname, "../../CHANGELOG.md");
      const dest = resolve(__dirname, "../guides/changelog.md");
      const content = readFileSync(src, "utf-8");
      writeFileSync(dest, FRONTMATTER + content);
    },
  };
};
