//! The parts of sudonotes that decide what a note *is*.
//!
//! Everything in this crate is pure: no filesystem, no network, no Tauri. That
//! is not tidiness for its own sake. A vault is a folder of Markdown files, and
//! more than one program is going to write into it — the desktop app today, a
//! browser build next. If those two disagree by so much as a quoted string in
//! the frontmatter, they will silently rewrite each other's files every time the
//! user switches between them.
//!
//! Keeping the format in one crate that both compile makes that class of bug
//! impossible by construction, rather than something a test suite has to catch
//! after the fact.

pub mod naming;
pub mod note;
pub mod split;
