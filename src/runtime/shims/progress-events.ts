/**
 * Hermes implements `Event.type` as a getter-only property. progress-events
 * 1.x assigns to it after `super(type)`, which throws on React Native. The
 * inherited value is already correct, so this React Native implementation only
 * needs to attach the detail payload.
 */
export class CustomProgressEvent<
  D = unknown,
  T extends string = string,
> extends Event {
  readonly detail: D;

  override get type(): T {
    return super.type as T;
  }

  constructor(type: T, detail?: D) {
    super(type);
    this.detail = detail as D;
  }
}

export type ProgressEvent<T extends string = string, D = unknown> = {
  readonly detail: D;
  readonly type: T;
};

export type ProgressEventListener<E extends ProgressEvent = ProgressEvent> = (
  event: E,
) => void;

export type ProgressOptions<E extends ProgressEvent = ProgressEvent> = {
  onProgress?: ProgressEventListener<E>;
};
