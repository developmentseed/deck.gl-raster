# Antimeridian explainer

A step-by-step animation of how deck.gl-raster meshes an image that crosses
the antimeridian (±180°): it unwraps the image's corners, snaps every
projected point to the nearest copy of the world, meshes it as usual, and cuts
the mesh at the world's edge. It works both as a talk prop and on its own.

This is an [explainer](../../README.md#explainers): its code was generated with
an LLM and hasn't been reviewed, so don't treat it as a pattern to copy.
