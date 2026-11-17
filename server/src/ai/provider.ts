import type { AiFeedback, AiRecipe, AiTutorials, PaintStock, Status } from '@minibald/shared';

/**
 * The only seam between the app and whoever generates the answers.
 * To use another vendor or a local model, implement this interface and return it from
 * `createAiProvider` (./index.ts): routes, validation, storage and UI stay untouched.
 */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  suggestRecipe(brief: RecipeBrief): Promise<AiResult<AiRecipe>>;
  critique(brief: FeedbackBrief): Promise<AiResult<AiFeedback>>;
  findTutorials(brief: TutorialsBrief): Promise<AiResult<AiTutorials>>;
}

export interface AiResult<T> {
  /** Not trusted yet: the caller validates it against the shared schema. */
  output: T;
  /** The model that actually answered (may differ from the configured one after a fallback). */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiImage {
  mediaType: 'image/jpeg';
  base64: string;
}

export interface MiniatureBrief {
  name: string;
  group: string | null;
  parentGroup: string | null;
  description: string | null;
  notes: string | null;
  status: Status;
  quantity: number;
  tags: string[];
}

export interface InventoryPaint {
  /** "Brand Name": the spelling the model must reuse for owned paints. */
  label: string;
  range: string;
  type: string | null;
  stock: PaintStock;
}

export interface RecipeBrief {
  miniature: MiniatureBrief;
  scheme: string | null;
  inventory: InventoryPaint[];
  image: AiImage | null;
  language: string;
}

export interface FeedbackBrief {
  miniature: MiniatureBrief;
  focus: string | null;
  /** Steps of the recipe being followed, if any, so advice can refer to them. */
  recipe: string | null;
  image: AiImage;
  language: string;
}

export interface TutorialsBrief {
  miniature: MiniatureBrief;
  query: string | null;
  language: string;
}

/** An error whose message is safe and useful to show in the UI. */
export class AiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
