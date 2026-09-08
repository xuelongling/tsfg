<!-- SPDX-License-Identifier: MIT -->

# Windows host development checks

Use the current Windows host. A Windows VM, Linux installation, cloud runner,
Stable release, or permission change on GitHub is not a prerequisite.
This entry orchestrates existing checks; it does not replace the six public
`tsfg-build` operations or change their input/network/security requirements.

## Prerequisites and storage

Use PowerShell 7, the reviewed E-drive Git executable with its recorded SHA-256,
and the cached Node matching the selected repository's Windows launcher identity.
The content-locked Windows cache must already be populated for native checks.
If it is missing, use the reviewed `prefetch` procedure; this driver never
downloads, installs, elevates, or disables security controls automatically.

Every argument path must be an absolute E-drive path without reparse points.
Use a dedicated workspace-level data directory outside the source repository.
The driver creates a unique run directory, redirects TEMP/TMP/TMPDIR and user
profile/application caches, disables Node compile-cache injection, and restores
its caller's environment on exit. Native compilation additionally uses the
existing sandbox's private work directory and explicit Zig local/global cache
arguments. `-Plan` records commands, not execution or successful acceptance.

For a new shell, redirect PowerShell's own cache before launching another shell.
Do not use a C-drive output path or an E-drive junction that leads elsewhere.
OS executables already under Windows are not copied or installed by these checks.

## Commands

Example for the current workspace's existing cache and reviewed Git. If tools
are deliberately updated, obtain the new reviewed identities; do not bypass a
digest mismatch. Run from the product checkout in PowerShell 7:

```powershell
$cache = 'E:/ws/pro_tsfg/.tmp/r00-win-cache'
$closure = (Get-Content -Raw -LiteralPath "$cache/active/windows-x86_64-msvc").Trim()
$checkOptions = @{
    DataRoot = 'E:/ws/pro_tsfg/.scratch/r00-20'
    CacheRoot = $cache
    NodePath = "$cache/$closure/node/node.exe"
    GitPath = 'E:/Program Files/Git/cmd/git.exe'
    GitSha256 = '22fead8244ef3a7225fb800099a4e43eca8bcec0466774917669599c2f19a05a'
}
& ./eng/windows-check.ps1 @checkOptions -Mode Quick
```

Quick runs format/typecheck plus launcher, driver, lock, compatibility,
candidate-CI and reproducibility regression tests. It intentionally omits
the slower full workspace-policy/materialization and native fixture suites.
Before integration, use `-Mode Quick -FullControlTests` for the complete
control-plane suite. Read its skipped tests: a zero exit is not proof of
unavailable symbolic-link, Linux or opt-in native acceptance. Test fixtures
never substitute for the native Integration mode.

For the working checkout, `-Mode Development` runs debug `build --dev` and
`test --dev`, including when source changes are uncommitted. Outputs are
non-publishable; this mode has no package/repro/promotion operation.

For a separate, already prepared clean product checkout:

```powershell
& ./eng/windows-check.ps1 @checkOptions -Mode Integration `
    -RepositoryRoot 'E:/ws/pro_tsfg/.scratch/r00-20/clean-source-20260908'
```

Integration runs build, test, package and package runtime smoke for both debug
and release using that checkout's public launcher. It does not clone, commit,
reset or clean it. A dirty checkout is rejected by the existing control plane.
Use `-Plan` with any mode to inspect commands without invoking the checks.

## Evidence and failures

Each run has `check-summary.json` with mode, driver digest, source HEAD/dirty
state, executable identities, paths, commands, logs and actual exit codes.
Native operations also emit their own versioned Build Reports. The orchestration
summary is not an Artifact Manifest, Release Evidence, or a full workspace
verification report. It must not be used to declare Development Ready by itself.

The driver stops at the first failure and propagates its native exit code;
configuration failures return 2. A planned command retains a null exit code.
When invoking the script from another `pwsh -Command` process, finish with
`exit $LASTEXITCODE` to preserve the script's code at that outer shell boundary.

The current native launcher requires permission to establish its WFP dynamic
process network boundary. On 2026-09-08, the task's unelevated Windows session
was denied that operation (Win32 5; Build Report exit 12). This is a local
permission prerequisite, not a need for a VM. An appropriately authorized
Windows session must run the same commands; the driver does not trigger UAC,
use another task's controller, or silently run without isolation. Activation
symlink tests also require the actual host's symlink capability.

## CI transition boundary

Existing product/manifest/agent workflows have not been changed by this driver.
Their current PR matrix remains effective until a separately authorized
migration is implemented and verified. A local Quick/Integration result cannot
satisfy an unrelated GitHub required check by renaming or fabricating evidence.
The intended split is local Windows checks now, then full platform, independent
VM/reproduction and Owner/release certification in R13. Source, license, input
identity and PR security checks remain applicable throughout.

The driver and its regression tests only orchestrate checks, not smoke payload
generation, and are not new Build Input Set entries. Payload generation stays
in the existing declared control plane. Their exact driver digest and source
state belong in check evidence, independently of Build Identity.
