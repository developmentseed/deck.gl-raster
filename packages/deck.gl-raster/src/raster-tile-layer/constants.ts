/** Size of deck.gl's common coordinate space in world units.
 *
 * At zoom 0, one tile covers the whole world (512×512 units); at zoom z, each
 * tile is 512/2^z units.
 */
export const TILE_SIZE = 512;

/** Size of the globe in web mercator meters. */
export const WEB_MERCATOR_METER_CIRCUMFERENCE = 40075016.686;

/** Scale factor for converting EPSG:3857 meters into deck.gl world units (512×512). */
export const WEB_MERCATOR_TO_WORLD_SCALE =
  TILE_SIZE / WEB_MERCATOR_METER_CIRCUMFERENCE;
