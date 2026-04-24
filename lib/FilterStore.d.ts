import { EventEmitter } from 'events';

export interface FilterDto {
  id: string;
  pattern: string;
  authorized: boolean;
  priority: number;
  /** When set together with `authorized: true`, the allow auto-flips to deny at that moment. */
  allowUntil: string | null;
}

export interface FilterDefault {
  pattern: string;
  authorized: boolean;
  priority?: number;
}

export interface FilterChangeEvent {
  id: string;
  reason: 'expired';
}

export default class FilterStore extends EventEmitter {
  constructor(opts?: { useMongo?: boolean; defaultFilters?: FilterDefault[] });
  readonly useMongo: boolean;
  init(): Promise<void>;
  list(): FilterDto[];
  isIdAuthorized(tunnelId: string): boolean;
  create(input: {
    pattern: string;
    authorized: boolean;
    priority?: number;
    allowUntil?: string | Date | null;
  }): Promise<FilterDto | null>;
  update(
    id: string,
    patch: {
      pattern?: string;
      authorized?: boolean;
      priority?: number;
      allowUntil?: string | Date | null;
    }
  ): Promise<FilterDto | null>;
  delete(id: string): Promise<FilterDto | null>;

  on(event: 'change', listener: (ev: FilterChangeEvent) => void): this;
  emit(event: 'change', ev: FilterChangeEvent): boolean;
}
