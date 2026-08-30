/**
 * Small marks used in the site's chrome — platform badges, buttons, meta rows.
 *
 * Brand marks come from simple-icons so they are the real artwork. Two are
 * drawn here instead:
 *
 *  - WINDOWS, because Microsoft asked simple-icons to drop its marks. The
 *    Windows 11 logo is four plain squares, so this is the actual geometry
 *    rather than an impression of it.
 *  - The interface glyphs (DOWNLOAD, PACKAGE), which are not anyone's brand.
 *
 * Every export is a path `d` on a 24x24 canvas. The brand paths are filled; the
 * two flagged below are meant to be stroked.
 */

import { siApple, siGithub, siLinux, siSnapcraft } from "simple-icons";

export const APPLE = siApple.path;
export const GITHUB = siGithub.path;
export const LINUX = siLinux.path;
export const SNAP = siSnapcraft.path;

/** The four panes of the Windows 11 logo, sized to fill as much of the canvas
 *  as the brand marks beside it do — at a smaller bounding box it read as the
 *  runt of the platform row. */
export const WINDOWS =
  "M2 2h9.4v9.4H2V2Zm10.6 0H22v9.4h-9.4V2ZM2 12.6h9.4V22H2v-9.4Zm10.6 0H22V22h-9.4v-9.4Z";

/** A balance scale, the usual glyph for a licence. Stroked.
 *
 *  Deliberately not the Open Source Initiative's logo: that mark stands for the
 *  organisation and its approval programme, and putting it beside "MIT
 *  licensed" would imply an endorsement nobody granted. */
export const SCALE =
  "M12 3.8v16.2M8 20.4h8M4.4 7.4h15.2M4.4 7.4 2 13.3h4.8L4.4 7.4ZM19.6 7.4 17.2 13.3H22L19.6 7.4Z";

/** Tray with an arrow dropping into it. Stroked. */
export const DOWNLOAD =
  "M12 3.5v10.5m0 0 4-4m-4 4-4-4M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2";

/** Arrow leaving a frame: this link opens the app rather than moving around the
 *  site. Stroked. */
export const LAUNCH =
  "M13.5 3.5h7v7M20.5 3.5 11 13M18 13.5v6a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6";

/** A closed box, for the installer size. Stroked. */
export const PACKAGE =
  "M12 2.8 20.5 7v10L12 21.2 3.5 17V7L12 2.8Zm0 0v18.4M3.5 7l8.5 4.6L20.5 7";
