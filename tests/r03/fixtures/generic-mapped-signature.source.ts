// 😀
export function mapped<T>(value: { [K in 'value']: T }['value']): { [K in 'value']: T }['value'] { return value; }