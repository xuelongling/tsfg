// 😀
export function entry(value: i32): i32 {
  try { throw value; } catch (caught) {
    try {
      if (typeof caught !== "boolean") { throw value; }
    } finally { }
    throw caught;
  }
}