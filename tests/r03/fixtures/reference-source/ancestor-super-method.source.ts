// 😀
export class Root {
  touch(seed: number): number { return seed; }
}
export class Middle extends Root {}
export class Leaf extends Middle {
  call(seed: number): number { return super.touch(seed); }
}