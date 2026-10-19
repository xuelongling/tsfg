// SPDX-License-Identifier: MIT
// Only exact independently prepared whole data; actual Source captures are bound separately.
import { oracle } from './readspan-return-test-helpers.mjs';
const pins=[
  {
    "file": "./readspan-return-first-oracle.json",
    "bytes": 667530,
    "sha256": "e9887966e68cd5dcbb042095f344f4a63d41b6070835ba37ccd5057758358e4d"
  },
  {
    "file": "./readspan-return-adjacent-part1-oracle.json",
    "bytes": 568808,
    "sha256": "ec4fdc9fcdd28f4e06e539c5101ab3ea1ae28497db926c85a197e2149909680e"
  },
  {
    "file": "./readspan-return-adjacent-part2-oracle.json",
    "bytes": 494026,
    "sha256": "16f5f98030d6859955e0884b2fb9046aa26fcb4ec1694ba731b52ac439f96c9e"
  },
  {
    "file": "./readspan-return-events-oracle.json",
    "bytes": 1241548,
    "sha256": "85d2555bd7b2bdff161d5eeb4e6d899cc4fd94ed538c8c1441576bb344cbf781"
  },
  {
    "file": "./readspan-return-family-uses-oracle.json",
    "bytes": 1179231,
    "sha256": "ca3ff4bea5a9eb22d57ab89126147187ef213868074a427a99723439d1fce289"
  },
  {
    "file": "./readspan-return-global-1024-oracle.json",
    "bytes": 8983583,
    "sha256": "f9d1956513228763f19df4b188745ebf2c60e7add365751408c106ea8b96401d"
  },
  {
    "file": "./readspan-return-global-1025-oracle.json",
    "bytes": 5590720,
    "sha256": "0e45adb427a4f0c710aae447eb59f43c7d3920d54582beb2aa4e04ebc6768888"
  },
  {
    "file": "./readspan-return-cold-oracle.json",
    "bytes": 1234505,
    "sha256": "bd5a26fe5862dcc41fc0f4eaae698a1577d95f4a90d50bc9e26a12259e08f5f8"
  },
  {
    "file": "./readspan-return-lowercore-oracle.json",
    "bytes": 19180,
    "sha256": "cf1e1b2c26864e2c6fcb7f011ec8b07ef38a888038c8334e241957281e009ae6"
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
    "file": "./readspan-return-synthetic-events101.json",
    "bytes": 363561,
    "sha256": "accf43dae290496056f49091720ce03487b1faca637bebe7f4e043d3ef5e2145"
  },
  {
    "file": "./readspan-return-synthetic-family-uses51.json",
    "bytes": 350017,
    "sha256": "0f336c62779775b1c68d845209eef67b2e209fd494b729eec227f92aaf2366c5"
  },
  {
    "file": "./readspan-return-synthetic-return-global-1025.json",
    "bytes": 4446606,
    "sha256": "98dcc14ae5cb9758df662ea4a525a5aeda3bed9379f538480e9072d3baff690f"
  }
];
/** Synthetic inputs trigger reconstruction; they never claim an upper published HIR.
 * @returns {Promise<Map<string,any>>} */
export async function returnSyntheticInputs() {
  return new Map((await Promise.all(syntheticPins.map(oracle))).map(row=>[row.name,row]));
}
