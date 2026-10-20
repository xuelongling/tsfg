// SPDX-License-Identifier: MIT
// Only exact independently prepared whole data; actual Source captures are bound separately.
import { oracle } from './readspan-return-test-helpers.mjs';
const pins=[
  {
    "file": "./readspan-return-first-oracle-v7.json",
    "bytes": 299608,
    "sha256": "9f068ba315f6c15e37651c7508570a9b20d60eb697dfc3d127cb4d1d06b12c75"
  },
  {
    "file": "./readspan-return-adjacent-part1-oracle-v7.json",
    "bytes": 569698,
    "sha256": "a7b2e1defb3ef632a19db8a29b612f309844537100edbb080c1d453b664551aa"
  },
  {
    "file": "./readspan-return-adjacent-part2-oracle-v7.json",
    "bytes": 494354,
    "sha256": "85dccaa7331852ddb278ab034239d8fe7d0d94959c446567a2752d8f3564ab41"
  },
  {
    "file": "./readspan-return-events-oracle-v7.json",
    "bytes": 1242097,
    "sha256": "26ca21f34df2e15d62b2f9cc24264e881b613a4ac03d074718fe2ae7efe20f81"
  },
  {
    "file": "./readspan-return-family-uses-oracle-v7.json",
    "bytes": 1178726,
    "sha256": "a9642a48fd643ebff27cb9fdf3ee2d0f7900b8b7843bdfa696f3fb2942b48e5b"
  },
  {
    "file": "./readspan-return-global-1024-oracle-v7.json",
    "bytes": 8983313,
    "sha256": "50a710563b1248f9936ffbeff2f089d80c54f793e1a5c951a0c51912a1148654"
  },
  {
    "file": "./readspan-return-global-1025-oracle-v7.json",
    "bytes": 5590450,
    "sha256": "4541f8e21601f9cf7bca2f1ddf068bf9a43de86c6619cc049eeb59d96cda280e"
  },
  {
    "file": "./readspan-return-cold-oracle-v7.json",
    "bytes": 1205264,
    "sha256": "7ef36b2b1cfabcc616b537aceac30955aa9ca545fddb9dc8236bd532eb2455ff"
  },
  {
    "file": "./readspan-return-lowercore-oracle-v7.json",
    "bytes": 19584,
    "sha256": "e94ce6a83661e649211d92e3433942a6a41272e2ce640f9408898bad16fbdec2"
  }
];
const data=Promise.all(pins.map(oracle));
/** @returns {Promise<any[]>} */
export async function returnRows() {
  const [first,part1,part2,events,family,lower,upper]=await data;
  return [...first.firstCases,...part1.cases,...part2.cases,...events.cases,...family.cases,lower.case,upper.case];
}
/** @returns {Promise<any[]>} */
export async function returnContextControls() { return (await data)[1].contextOnlyControls; }
/** @returns {Promise<any>} */
export async function returnColdOracle() { return (await data)[7]; }
/** @returns {Promise<Record<string,any>>} */
export async function returnCoreDiagnostics() {
  return Object.fromEntries((await data)[8].cases.map(row=>[row.name,row.expectedDiagnostic]));
}

const syntheticPins=[
  {
    "file": "./readspan-return-synthetic-events101-v7.json",
    "bytes": 364592,
    "sha256": "4d68e1b0d80c24bdfef1d13dce92f6815842e2477b0a7b94e23118397c673f71"
  },
  {
    "file": "./readspan-return-synthetic-family-uses51-v7.json",
    "bytes": 351052,
    "sha256": "92667f523e64a3a288411c95845117876cc0ee5882c47420fcf26bb85517d158"
  },
  {
    "file": "./readspan-return-synthetic-return-global-1025-v7.json",
    "bytes": 4447647,
    "sha256": "f2999316700da8934f303720e63475ee3a9a62e2fcacaff667532bbdd1dc8382"
  }
];
/** Synthetic inputs trigger reconstruction; they never claim an upper published HIR.
 * @returns {Promise<Map<string,any>>} */
export async function returnSyntheticInputs() {
  return new Map((await Promise.all(syntheticPins.map(oracle))).map(row=>[row.name,row]));
}
