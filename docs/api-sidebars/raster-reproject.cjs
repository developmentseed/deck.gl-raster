// @ts-check
/** @type {import("@docusaurus/plugin-content-docs").SidebarsConfig} */
module.exports = {
  apiSidebar: [
    { type: "doc", id: "index", label: "Overview" },
    ...require("../api/raster-reproject/typedoc-sidebar.cjs"),
  ],
};
