export class Base {
  value: number = 1;
  constructor(seed: number) { this.value = seed; }
}
export class Derived extends Base {
  extra: number = 2;
}