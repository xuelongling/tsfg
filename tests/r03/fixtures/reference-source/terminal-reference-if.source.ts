// 😀
export class Box {
  choose(flag: bool, other: Box): Box {
    if (flag) { return this; } else { return other; }
  }
}