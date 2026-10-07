// Minigame contract: the host provides a zone (the scene), the minigame fills it then ends.
// A minigame never fails: the promise resolves when you win or skip.

/**
 * What the host hands a minigame: its zone, the unit scale, images and sounds, parameters, labels and an abort signal.
 * @extension
 */
export interface MinigameCtx {
  /** Element covering the scene (relative position, 16:10 format). The minigame fills it and cleans it up. */
  root: HTMLElement;
  /** Pixels per logical unit (root's width / 640). */
  u: number;
  /** URL of an image, by id (e.g. 'board/r3c2'). All images come from `params`: the engine names none of them. */
  img(id: string): string;
  /** Native size of an image, in pixels (for the width/height ratio). */
  size(id: string): [number, number];
  sfx(id: string): void;
  /** Shows or updates the instruction frame (the game's hint voice), supplied by the host. */
  instruct(text: string): void;
  params: Record<string, unknown>;
  labels: { skip: string; jump: string; duck: string; [k: string]: string };
  /** Cancelled when the host closes the minigame. */
  signal: AbortSignal;
  /** UI CSS font families (skin.fonts), for what doesn't go through CSS variables (canvas). */
  fonts?: { ui: string; pixel: string };
}

/** A minigame: `run(ctx)` until it is won or skipped, and what the validator reads of its params. @extension */
export interface Minigame {
  run(ctx: MinigameCtx): Promise<void>;
  /** Required params: the validator flags a `{ minigame }` that doesn't provide them. */
  required?: string[];
  /** Dot paths of player-visible strings in params. `*` visits every array item or object value. */
  textParams?: string[];
  /** Params that name an image id or a sound id: the validator checks they exist (images are also found by shape). */
  bindings?: { images?: string[]; sfx?: string[] };
}
