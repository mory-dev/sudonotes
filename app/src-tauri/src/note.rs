//! Getting a note onto disk.
//!
//! The note format itself — parsing, serialization, slugs, links — lives in
//! `sudonotes-core` and is re-exported here so the rest of the app keeps using
//! `crate::note::*`. Only the part that needs a filesystem is defined here.

use std::fs;
use std::path::Path;

pub use sudonotes_core::note::{
    body_hash, extract_links, filename_for, now_rfc3339, replace_links, slugify, Frontmatter,
    MarkState, Note, NoteType,
};

/// Writing a note to a real path. An extension trait rather than an inherent
/// method, because `Note` belongs to a crate that must not know what a file is.
pub trait WriteNote {
    fn write_to(&self, path: &Path) -> std::io::Result<()>;
}

impl WriteNote for Note {
    /// Write the note to disk atomically: a sibling temp file followed by a
    /// rename, so a crash mid-write cannot truncate an existing note.
    fn write_to(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("md.tmp");
        fs::write(&tmp, self.to_markdown())?;
        fs::rename(&tmp, path)
    }
}
