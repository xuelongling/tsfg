// SPDX-License-Identifier: MIT
import { own, record, check, same } from './reference-common.mjs';

// Root independently pinned this private candidate descriptor to the canonical
// v5 declaration bytes and alias/brand anchors. Graphs and callers cannot select
// a policy. This is structural correspondence, not formal M09/Source admission.
const policy = own({
  "declaration": {
    "role": "canonical-r01-scalars",
    "sha256": "sha256:60974c1fa82cc549da3a9268f5d82ab10b58f52e2612a377ee4577f05af52c86",
    "surrogateStarts": [],
    "utf16Length": 17464,
    "version": "minimal-conversions-v5"
  },
  "format": {
    "family": "tsfg.reference-scalar-declaration-candidate",
    "positionUnit": "utf16",
    "version": 1
  },
  "nominals": [
    {
      "alias": {
        "end": 849,
        "start": 797
      },
      "brand": {
        "end": 386,
        "start": 376
      },
      "scalar": "i32"
    },
    {
      "alias": {
        "end": 1339,
        "start": 1287
      },
      "brand": {
        "end": 1270,
        "start": 1260
      },
      "scalar": "f32"
    }
  ]
});

export function verifyReferenceNominal(type, sources) {
  record(type.nominal, ['source','sha256','version','alias','brand']);
  const nominal = type.nominal;
  const candidates = [...sources.values()].filter(source => source.declaration
    && source.sha256 === policy.declaration.sha256);
  check(candidates.length === 1, 'nominal', 'canonical scalar declaration role is missing or ambiguous');
  const source = candidates[0], expected = policy.nominals.find(item => item.scalar === type.scalar);
  if (!expected) return check(false, 'nominal', 'scalar kind has no private declaration policy');
  check(source.utf16Length === policy.declaration.utf16Length
    && same(source.surrogateStarts, policy.declaration.surrogateStarts)
    && nominal.source === source.path && nominal.sha256 === policy.declaration.sha256
    && nominal.version === policy.declaration.version, 'nominal');
  for (const key of ['alias','brand']) {
    record(nominal[key], ['source','start','end']);
    check(same(nominal[key], { source: source.path, ...expected[key] }), 'nominal',
      'scalar alias/brand does not match the private declaration policy', nominal[key]);
  }
}
