// SPDX-License-Identifier: Apache-2.0
// 😀 Keep the complete original Program and independent UTF16 field anchors.
@component
export class CopyDestination { pad: f32 = 0; n: i32 = 0; }
@component
export class CopySource { n: i32 = 0; }
@system
export function copyI32(q: Query<[Write<CopyDestination>, Read<CopySource>]>): void {
  for (const [dst, src] of q) {
    dst.n = -2147483648;
    dst.n = 0X7fff_ffff;
  }
}
function unused(value: i32): i32 { return value; }
class Box { value: i32 = 7; }
