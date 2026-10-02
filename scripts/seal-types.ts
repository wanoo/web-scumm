/** Private configuration for the sealed ending (games/<id>/private/ending.config.ts). Only the chosen outcome is encrypted. */
export interface OutcomeTexts {
  /** Text under the scratch area (simple HTML). */
  ticket: string;
  /** Big announcement on the final card. */
  headline: string;
  lines?: string[];
}

export interface EndingConfig {
  /** Must match the game's `ending.password` (given), or what the player types (typed). */
  password: string;
  /** Possible outcomes, free-form keys (`npm run seal -- --outcome=<key>`). The key is compared to the guess flag. */
  outcomes: Record<string, OutcomeTexts>;
  /** Short note, common to all outcomes. */
  message: string;
  /** Card photos, paths relative to games/<id>/private/ (jpg, png, webp, < 500 KB). */
  photos: string[];
  /** Common lines, added after the outcome's own. */
  lines?: string[];
  /** false: the sealed file doesn't give away the outcome, the player's guess isn't judged (test version). */
  judgeGuess?: boolean;
}

/** Old name (old configuration files). */
export type RevealConfig = EndingConfig;
