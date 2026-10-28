// 😀
export function leaf<U>(value: U extends boolean ? boolean : number): U extends boolean ? boolean : number { return value; }
export function route<T>(value: T extends boolean ? boolean : number): T extends boolean ? boolean : number { return leaf<T>(value); }