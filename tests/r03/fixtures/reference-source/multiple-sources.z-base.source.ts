// 😀 base
export class Base {
  value: number;
  constructor(seed: number) { this.value = seed; }
  touch(seed: number): number { this.value = seed; return this.value; }
}