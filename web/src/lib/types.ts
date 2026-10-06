/** The wire types live in the server workspace; this is a type-only
 *  re-export so both sides compile against one definition. `export type *`
 *  is erased at build time, so nothing from `server/` ends up in the bundle. */
export type * from '../../../server/src/types.js';
