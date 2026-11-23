// UBEC demo seed: the standard seed with the programme tenant named and branded for UBEC.
// Run with `npm run prisma:seed:ubec` (from server/). The standard seed is `npm run prisma:seed`.
process.env.SEED_PROFILE = "ubec";

import("./seed");
