export class Left { value: number = 1; }
export class Right { value: number = 2; }
export class Compare {
  same(left: Left, right: Left): boolean { return left === right; }
  different(left: Left, right: Left): boolean { return left !== right; }
  across(left: Left, right: Right): boolean { return left === right; }
}