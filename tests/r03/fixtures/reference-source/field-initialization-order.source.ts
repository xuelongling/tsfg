// 😀
export class Base {
  baseValue: number = 1;
}
export class Derived extends Base {
  derivedValue: number = 2;
  constructor() { super(); }
}