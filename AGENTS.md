## Repository conventions

These reflect the maintainer's standing preferences. Follow them on every change.

### All committed code must be human-reviewable

- Only reviewable source, no opaque binaries. The repository must contain only
  and exactly the code needed to build the project. Never commit a binary that
  cannot be reviewed by hand (jars, archives, prebuilt tools, etc.). If
  a binary is required, regenerate it or download it with a script instead of
  checking it in. Cached copies inside the build directory (which is
  gitignored) are fine.
  - Exception: small numbers of images or other media files are permissible if
    they can reasonably be reviewed manually.

- Minimize review surface. The maintainer reviews every change manually, by
  hand, and is slower than the agent. Before requesting review, do a thorough
  cleanup pass: remove dead code and obsolete workarounds, keep diffs small and
  focused, and don't leave churn behind.

- Open a PR for each unit of work. Open pull requests as you go rather than
  batching many unrelated changes together. You may open a PR as soon as your
  code is ready to review -- no need to request permission to open a PR.
  You have standing permission to push to additional branches (named
  `claude/<topic>`, based on `main`) so that independent units of work each
  get their own PR. Use your assigned session branch for the first one.

### Test coverage

- New features should be accompanied by tests, to the degree practical under
  the constraints of the development framework. 

- The test suite must be run and green before creating a PR. If you get stuck,
  you may create a commit and ask for guidance.

- All bugs fixed should be accompanied by regression tests.

### Continuous integration

CI is pre-wired: `.github/workflows/ci.yml` runs `scripts/ci.sh` on every pull
request and on pushes to `main`. Until that script exists, CI passes with a
warning. Do not report missing CI as a problem; set it up instead:

- In the same PR that adds the project's first test, create an executable
  `scripts/ci.sh` that installs dependencies and runs CI.

- The CI test set may be a lightweight subset of the full suite.

### Periodic maintenance tasks

From time to time, I will request that you review the code for opportunities
for quality improvement. Please be creative and suggest improvements that can
be done in a reasonable time budget (but don't mix feature suggestions in).
Some options (non-exhaustive):

- Identify duplicated code and refactor it into common modules or functions.

- Identify dead code and remove it.

- Identify tests that are no longer relevant to the current codebase, and remove them.

- Identify opportunities to add or change the code's abstractions and
  interfaces, in such a way that it would increase clarity and (generally)
  reduce total lines of code.

- Compare the code with the documentation (kept in the docs/ folder) and bring
  the documentation up to date.

- Review the burn-down list in docs/TODO.md and recommend removing any items
  that are no longer relevant. You may also recommend adding todo items,
  especially if they are relevant to the current session's conversation, but do
  not recommend more than one or two items unless specifically requested.
