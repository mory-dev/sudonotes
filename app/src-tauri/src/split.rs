//! Splitting a pasted blob into prompts. Defined in `sudonotes-core` so the
//! desktop app and a browser build divide the same paste the same way.

pub use sudonotes_core::split::{split, DraftPrompt};
