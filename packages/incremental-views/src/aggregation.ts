import { BehaviorSubject } from 'rxjs';
import type { AggregateOp } from './types.js';

/** Configuration for creating an incremental aggregation */
export interface AggregationConfig {
  field: string;
  operation: AggregateOp;
}

interface AggregationState {
  count: number;
  sum: number;
  min: number;
  max: number;
  distinctValues: Set<unknown>;
}

/** Creates an incremental aggregation that maintains running state */
export function createIncrementalAggregation(config: AggregationConfig) {
  const state: AggregationState = {
    count: 0,
    sum: 0,
    min: Infinity,
    max: -Infinity,
    distinctValues: new Set(),
  };

  const values: number[] = [];
  const subject = new BehaviorSubject<number>(computeValue());

  function computeValue(): number {
    switch (config.operation) {
      case 'count':
        return state.count;
      case 'sum':
        return state.sum;
      case 'avg':
        return state.count === 0 ? 0 : state.sum / state.count;
      case 'min':
        return state.count === 0 ? 0 : state.min;
      case 'max':
        return state.count === 0 ? 0 : state.max;
      case 'distinct_count':
        return state.distinctValues.size;
    }
  }

  function recomputeMinMax(): void {
    if (values.length === 0) {
      state.min = Infinity;
      state.max = -Infinity;
    } else {
      state.min = Math.min(...values);
      state.max = Math.max(...values);
    }
  }

  function emit(): void {
    subject.next(computeValue());
  }

  function processInsert(value: number): void {
    state.count++;
    state.sum += value;
    values.push(value);
    if (value < state.min) state.min = value;
    if (value > state.max) state.max = value;
    state.distinctValues.add(value);
    emit();
  }

  function processDelete(value: number): void {
    const idx = values.indexOf(value);
    if (idx === -1) return;

    state.count--;
    state.sum -= value;
    values.splice(idx, 1);
    recomputeMinMax();
    // Rebuild distinct values from remaining
    state.distinctValues.clear();
    for (const v of values) {
      state.distinctValues.add(v);
    }
    emit();
  }

  function processUpdate(oldValue: number, newValue: number): void {
    processDelete(oldValue);
    processInsert(newValue);
  }

  function getValue(): number {
    return computeValue();
  }

  function reset(): void {
    state.count = 0;
    state.sum = 0;
    state.min = Infinity;
    state.max = -Infinity;
    state.distinctValues.clear();
    values.length = 0;
    emit();
  }

  return {
    field: config.field,
    operation: config.operation,
    value$: subject.asObservable(),
    processInsert,
    processDelete,
    processUpdate,
    getValue,
    reset,
  };
}
