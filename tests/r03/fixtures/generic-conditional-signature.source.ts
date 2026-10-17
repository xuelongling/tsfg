// 😀
export function select<T>(value: T extends boolean ? boolean : number): T extends boolean ? boolean : number { return value; }