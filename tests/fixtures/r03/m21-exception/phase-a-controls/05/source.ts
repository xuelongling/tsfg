// 😀
export function entry(value: i32): i32 {
  try { throw value; } catch (caught) {
    if (typeof caught !== "boolean") { throw value; }
    try { } finally { }
    throw caught;
  }
}