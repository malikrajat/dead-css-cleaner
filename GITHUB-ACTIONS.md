# GitHub Actions — branch rules and how to change them

This project runs its workflows **only from `main`**:

| Event | Allowed? |
| --- | --- |
| Push (or merge) to `main` | ✅ runs |
| Push to any other branch (`feature/*`, `dev`, `release/*`, ...) | ❌ never triggers |
| Pull request (any base branch) | ❌ never triggers |
| Tag `v*` whose commit is on `main` | ✅ runs (release) |
| Tag `v*` whose commit is not on `main` | ❌ triggers, then fails at the guard |
| Manual run (`workflow_dispatch`) from `main` | ✅ runs |
| Manual run (`workflow_dispatch`) from another branch | ❌ triggers, then fails at the guard |
| Weekly CodeQL schedule | ✅ runs on the default branch (`main`) |

Two mechanisms enforce this:

1. **Trigger filters** (`on.push.branches: [main]`, no `pull_request` block) — other branches never *start* a workflow.
2. **A reusable guard job** ([`.github/workflows/branch-guard.yml`](.github/workflows/branch-guard.yml)) — every other workflow calls it as its first job, and all real work depends on it. For tags it verifies with `git merge-base --is-ancestor` that the tagged commit is contained in `origin/main`, which is what makes "tags must come from main" enforceable.

If the guard blocks a run you will see it immediately in the run summary:

```text
[error] CI may only run on 'main' or on a tag created from 'main'.
Blocked because: pushed to branch 'feature/login'.
See GITHUB-ACTIONS.md to change this rule.
```

---

## The workflows

| File | Triggers today | Guarded | Purpose |
| --- | --- | --- | --- |
| [`.github/workflows/branch-guard.yml`](.github/workflows/branch-guard.yml) | `workflow_call` | — | The rule itself: branch name + "tag points at main" check |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | `push` → `main`, `workflow_dispatch` | ✅ `guard` job, all jobs `needs: guard` | Manifest, lint, format, type check, unit tests, coverage, integration tests, build, package, summary |
| [`.github/workflows/release.yml`](.github/workflows/release.yml) | `push` → tags `v*`, `workflow_dispatch` | ✅ `guard` job | Publish to the VS Code Marketplace + GitHub release (no artifacts attached) |
| [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml) | `push` → `main`, `schedule`, `workflow_dispatch` | ✅ `guard` job | CodeQL security analysis |

None of the workflows upload artifacts; that is enforced too (see [No stored artifacts](#no-stored-artifacts)).

---

## I want to allow another branch — what do I change?

There are exactly two places per workflow, and the rule itself lives in one place.

### 1. The rule itself (one place, applies to every workflow)

`/.github/workflows/branch-guard.yml` → the default of `allowedBranch`:

```yaml
on:
  workflow_call:
    inputs:
      allowedBranch:
        description: Branch that may trigger workflows, and that release tags must point at
        required: false
        type: string
        default: main        # <-- change this to your branch, e.g. release
```

That single edit changes what the guard accepts for **all** workflows, including the
"tags must come from this branch" check and manual dispatches.

### 2. The trigger filters (one line per workflow)

GitHub does not allow variables inside `on:`, so the branch name must also be written in the
`push` filter of each workflow that should run on it:

```yaml
# .github/workflows/ci.yml  (and codeql.yml)
on:
  push:
    branches:
      - release        # was: main
```

```yaml
# .github/workflows/release.yml — unchanged; it triggers on tags, not branches
on:
  push:
    tags:
      - "v*"
```

`release.yml` and `codeql.yml` do not need a `push.branches` change for a *new* branch to be
allowed, because the guard is what decides whether a tag or a manual run may proceed. Only
`ci.yml` (and `codeql.yml`, if you want CodeQL on that branch) needs the trigger edit to
*start* runs there.

### Allowing several branches

```yaml
on:
  push:
    branches:
      - main
      - release
      - "hotfix/**"     # glob patterns are supported
```

Then make the guard accept them. Replace the `branch)` case in `branch-guard.yml` with a
list check, for example an allow-list input:

```yaml
    inputs:
      allowedBranch:
        type: string
        default: "main release"   # space separated
```

```bash
          case " ${ALLOWED_BRANCH} " in
            *" ${GITHUB_REF_NAME} "*) allowed="true" ;;
            *) reason="pushed to branch '${GITHUB_REF_NAME}' which is not in '${ALLOWED_BRANCH}'" ;;
          esac
```

For the tag rule, `git merge-base --is-ancestor` is run once per allowed branch — keep the
release tags coming from a single branch if you can, it is the simplest rule to reason about.

### Re-enabling pull-request checks (optional)

By design pull requests do **not** trigger anything today, so a PR from a feature branch
cannot run workflows. If you later want PR validation into `main` (the usual trade-off:
earlier feedback), add this to `ci.yml` and `codeql.yml`:

```yaml
on:
  pull_request:
    branches:
      - main          # only PRs whose BASE is main
```

The `guard` job still applies: a PR run reports `github.ref_type = branch` and
`github.ref_name = <merge ref>`, so for PR runs you must relax the guard (for example skip it
when `github.event_name == 'pull_request'`). If you go that route, delete the guard from the
PR-triggered jobs or give the guard an extra input such as `allowPullRequests: true`.

### Renaming the default branch (for example `main` → `master`)

1. `branch-guard.yml` → `allowedBranch.default: master`.
2. `ci.yml` → `on.push.branches: [master]`.
3. `codeql.yml` → `on.push.branches: [master]` (the weekly schedule follows the default
   branch automatically).
4. Nothing to change in `release.yml`.

### Allowing release tags from a different branch

The check is the `tag)` case in `branch-guard.yml`. To allow a tag from any branch (not
recommended), delete the `git merge-base --is-ancestor` check and set `allowed="true"`. To
allow tags from a second branch, fetch that branch too and accept the tag when the
`merge-base` check succeeds against either branch.

---

## Verifying your change

```bash
npm run verify:manifest
```

That check fails when:

- a workflow uploads or downloads artifacts;
- a workflow has a `pull_request` trigger (the current policy);
- a `push` trigger lists a branch other than the allowed one;
- a workflow that runs on push, tags, schedule or dispatch does not call the guard;
- the guard lost its `git merge-base --is-ancestor` tag check.

Because the rule lives in the guard workflow, the fastest end-to-end test is a throwaway
branch: push a commit to `feature/guard-test` — `ci.yml` should not appear in the Actions
tab at all — then create a tag on that commit; the release workflow should start and fail in
the `Guard` job with the "does not point at a commit on main" message.

### Run the guard locally (recommended after any change)

```bash
npm run verify:guard
```

That script extracts the shell from `branch-guard.yml`, builds a throwaway git repository in
your temp folder with a `main` branch, a `feature` branch and one tag on each, and asserts:

```text
  [ok]   commit on main is an ancestor of origin/main  -> yes
  [ok]   commit on a side branch is not                -> no
  [ok]   push to main                   -> allowed (expected allowed)
  [ok]   push to feature branch         -> blocked (expected blocked)
  [ok]   tag created on main            -> allowed (expected allowed)
  [ok]   tag created on a side branch   -> blocked (expected blocked)

  0 failure(s)
```

`npm run verify` runs it as part of the normal check suite, so CI executes it on every run.
On Windows you need Git Bash available for the shell part; without a usable bash the script
still verifies the git ancestry primitive and skips the shell execution with a clear message.

---

## No stored artifacts

Independent of the branch rules: no workflow stores artifacts. There are no
`actions/upload-artifact` or `actions/download-artifact` steps, and release runs do not
attach the VSIX to the GitHub release — the package goes to the VS Code Marketplace and is
then discarded. Coverage, the `dist/` bundle and the VSIX are verified in place and their
evidence is printed to the job log. The only persisted state is the standard `setup-node`
npm cache, which GitHub expires automatically.

`npm run verify:manifest` enforces this as well, so an artifact step cannot be reintroduced
without the check failing.
