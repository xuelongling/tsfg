export class ReadView { readonly value: number = 0; }
export class Mutable {
  padding: boolean = true;
  value: number = 1;
  view: ReadView = this;
  asView(): ReadView { return this; }
}
export class Holder {
  view: ReadView;
  constructor(source: Mutable) { this.view = source; source.value = 2; }
  accept(value: ReadView): ReadView { return value; }
  transfer(source: Mutable): ReadView { return this.accept(source); }
  read(): number { return this.view.value; }
}