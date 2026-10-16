export class Scalars {
  i: i32;
  f: f32;
  d: number;
  b: bool;
  constructor(i: i32, f: f32, d: number, b: bool) {
    this.i = i;
    this.f = f;
    this.d = d;
    this.b = b;
  }
  readI32(): i32 { return this.i; }
  readF32(): f32 { return this.f; }
  readNumber(): number { return this.d; }
  readBool(): bool { return this.b; }
}