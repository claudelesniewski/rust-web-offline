# TODO

- Mirror the toolchain files to a release of this repository. They are
  fetched from a pinned commit of rust-playground-inbrowser-site, which that
  project replaces on every deploy, so the commit may eventually become
  unreachable (CI's Actions cache holds a copy meanwhile).
- Clickable compiler diagnostics (jump to file and line).
- Type-aware completion after `.`: find the receiver's type by compiling a
  probe with rustc (as in `let _: () = expr;`, whose error names the type),
  then offer that type's methods from the offline docs' search index.
