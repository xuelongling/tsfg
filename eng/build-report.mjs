// SPDX-License-Identifier: MIT
import process from "node:process";
import { canonicalize, writeAtomicText } from "./build-data.mjs";

async function writeReport(reportPath, report) {
  await writeAtomicText(reportPath, `${canonicalize(report)}\n`);
}

export async function fail(command, code, category, issue, reportPath, network) {
  const report = {
    schemaVersion: "1",
    command,
    status: "failure",
    network,
    telemetry: false,
    error: {
      code: String(code),
      category,
      issues: [issue],
    },
  };
  if (reportPath) {
    try {
      await writeReport(reportPath, report);
    } catch (error) {
      process.stderr.write(`cannot write Build Report: ${error.message}\n`);
      return 30;
    }
  }
  process.stderr.write(`${issue.message}\n`);
  return code;
}

export async function succeed(command, result, reportPath, network) {
  const report = {
    schemaVersion: "1",
    command,
    status: "success",
    network,
    telemetry: false,
    result,
  };
  if (reportPath) {
    await writeReport(reportPath, report);
  }
  process.stderr.write(`${command} completed\n`);
  return 0;
}
