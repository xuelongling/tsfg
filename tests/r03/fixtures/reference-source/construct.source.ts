export class Counter { value: number = 1; constructor(seed: number) { this.value = seed; } }
export class Factory {
  fresh: Counter = new Counter(5);
  make(seed: number): Counter { return new Counter(seed); }
}