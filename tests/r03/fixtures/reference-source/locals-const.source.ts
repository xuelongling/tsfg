// 😀
export class Box {
  value: number;
  constructor(seed: number) { this.value = seed; }
  share(other: Box): Box {
    const alias: Box = other;
    alias.value = this.value;
    return alias;
  }
  keep(other: Box): Box { const alias: Box = other; return alias; }
  passScalar(seed: number): number { const alias: number = seed; return alias; }
}