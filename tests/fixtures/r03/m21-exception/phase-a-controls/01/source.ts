// 😀
export function entry(𝐀: i32): i32 {
  try {
    throw 𝐀;
  } catch (caught) {
    throw caught;
  } finally {
    const copied: i32 = 𝐀;
  }
}