// 😀
export function undefined(value: i32): i32 {
  try {
    throw value;
  } catch (caught) {
    throw caught;
  } finally {
    const copied: i32 = value;
  }
}