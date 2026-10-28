// SPDX-License-Identifier: MIT


export class ConfigurationError extends Error {
  constructor(message, issueCode = "invalid-configuration") {
    super(message);
    this.issueCode = issueCode;
  }
}

export class BuildFailureError extends Error {}

export class BuildPolicyError extends BuildFailureError {}

export class TestFailureError extends Error {
  constructor(message, issueCode = "native-test") {
    super(message);
    this.issueCode = issueCode;
  }
}

export class CompatibilityFailureError extends TestFailureError {
  constructor(issueCode, message, compatibility) {
    super(message);
    this.issueCode = issueCode;
    this.compatibility = compatibility;
  }
}

export class PackageFailureError extends Error {}

export class OfflineBoundaryError extends Error {}

export class UndeclaredInputError extends Error {}

export class SandboxBoundaryError extends Error {}

export class GoInputIntegrityError extends Error {}

export class GoExecutionFailureError extends BuildFailureError {
  constructor(preparation, message) {
    super(message);
    const { astIntake, ...publicPreparation } = preparation;
    this.preparation = publicPreparation;
  }
}

export class GoPreparationBoundaryError extends SandboxBoundaryError {
  constructor(preparation, message = "Go native supervisor could not establish the required execution boundary") {
    super(message);
    const { astIntake, ...publicPreparation } = preparation;
    this.preparation = publicPreparation;
  }
}

export class ReproducibilityMismatchError extends Error {
  /**
   * @param {string} member
   * @param {string} message
   * @param {string} [issueCode]
   * @param {{leftSha256?: string, offset?: string, rightSha256?: string}} [details]
   */
  constructor(member, message, issueCode = "reproducibility-set", details = {}) {
    super(message);
    this.member = member;
    this.issueCode = issueCode;
    this.leftSha256 = details.leftSha256;
    this.offset = details.offset;
    this.rightSha256 = details.rightSha256;
  }
}

export const SANDBOX_NETWORK_BOUNDARY_STATUS = 123;

export const SANDBOX_UNDECLARED_INPUT_STATUS = 124;

export const SANDBOX_SETUP_FAILURE_STATUS = 125;

export const WINDOWS_NETWORK_ISOLATION = Object.freeze({
  mode: "wfp-dynamic-app-id",
  scope: "locked-process-set",
  status: "blocked",
});

export const WINDOWS_SANDBOX_EXECUTABLE_DIGEST =
  "sha256:e521f581c28c7ce45e85d7d3d2525286009685a79c1957f1b9313e5ce3a2c0df";

export const WINDOWS_PUBLICATION_EXECUTABLE_DIGEST =
  "sha256:61a6d286d66b5233732ef5dd07f59fad643760f37e12f52d76d2d5e561cded3c";

export class WorkspaceMismatchError extends Error {
  constructor(code, message) {
    super(message);
    this.issueCode = code;
  }
}
