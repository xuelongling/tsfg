// 🧭 main
import { Base as Ancestor } from "./z-base";
export class Derived extends Ancestor {
  override touch(seed: number): number { return this.value; }
  make(seed: number): Ancestor {
    const made: Ancestor = new Ancestor(seed);
    made.touch(seed);
    return made;
  }
  rebind(other: Ancestor, replacement: Derived): void {
    let alias: Ancestor = other;
    alias = replacement;
  }
}