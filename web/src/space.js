/* Infinite Frames: universes.
 *
 * One table holds every universe. A universe's documents carry its name at the front of their
 * id ("game~~<id>"); the archive (the original shared canvas) is every document without one.
 * The address picks the universe: no ?space opens the game's universe, ?space=archive opens the
 * original canvas, ?space=<name> opens (or starts) any other. Nothing is ever moved or deleted.
 */
export const SEP = "~~", DEFAULT_SPACE = "game", ARCHIVE = "archive";

/** The universe named in an address's query string. */
export function spaceFrom(search) {
  const raw = (new URLSearchParams(search || "").get("space") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);
  return raw || DEFAULT_SPACE;
}
/** id as stored, for a document of this universe */
export const toDb = (space, id) => (space === ARCHIVE ? id : space + SEP + id);
/** does a stored id belong to this universe? */
export const inSpace = (space, dbId) => (space === ARCHIVE ? !dbId.includes(SEP) : dbId.startsWith(space + SEP));
/** the app's own id, from a stored id of this universe */
export const fromDb = (space, dbId) => (space === ARCHIVE ? dbId : dbId.slice(space.length + SEP.length));
/** narrow a Supabase query on the table to this universe */
export const scope = (space, query) => (space === ARCHIVE ? query.not("id", "like", "%" + SEP + "%") : query.like("id", space + SEP + "%"));
