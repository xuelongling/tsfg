export class Base {
  value: number = 1;
  constructor(seed: number) {
    this.value = seed;
    this.observe(this);
    this.touch();
  }
  observe(other: Base): number { return other.value; }
  touch(): number { return this.value; }
}
export class Derived extends Base {
  extra: number = 2;
  constructor(seed: number) {
    super(seed);
    this.extra = this.touch();
  }
  override touch(): number { return this.value; }
  baseTouch(): number { return super.touch(); }
}