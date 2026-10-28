// 😀
export class Base {
  value: number;
  constructor(seed: number) { this.value = seed; }
}
export class Derived extends Base {
  replace(other: Base, replacement: Derived): Derived {
    let alias: Base = other;
    return alias = replacement;
  }
}