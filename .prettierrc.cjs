// Shared options for generated Supabase types (matches `supabase gen types` style).
// CI formats temp files with `--config prettier.database-types.json` (same object).
const dbTypes = require('./prettier.database-types.json');

module.exports = {
  singleQuote: true,
  overrides: [
    {
      files: 'packages/supabase/src/lib/database.types.ts',
      options: dbTypes,
    },
  ],
};
