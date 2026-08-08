//! Compressed snapshots of a vault, written outside it.
//!
//! The point of this feature is to survive the vault folder being deleted, so
//! archives live in the app's own data directory and never inside the vault.
//!
//! This module only ever *reads* the vault. Nothing here deletes, moves or
//! rewrites a note, and the only files it removes are its own archives during
//! rotation — matched by name, in the backup directory, and nowhere else.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;

use crate::vault::Vault;

/// Archives are named so rotation can recognise its own work and refuse to
/// touch anything else in the directory.
const PREFIX: &str = "sudonotes-vault-";
const SUFFIX: &str = ".bak";

/// How many snapshots to keep. Markdown compresses to almost nothing, so this
/// is generous without being worth a setting.
const KEEP: usize = 20;

/// Skip a run when the newest archive is younger than this.
const MIN_INTERVAL_SECS: u64 = 6 * 60 * 60;

const README: &str = "\
This is a sudonotes vault backup.

Despite the .bak extension it is an ordinary ZIP archive: rename it to .zip to
open it in Explorer, Finder or any unzip tool. Inside you will find the
prompts/ and ideas/ folders exactly as they were in the vault.

To restore, unzip it over an empty folder and open that folder as a vault.
Nothing else in the archive is required.
";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    /// RFC3339, from the file's own modified time.
    pub created: String,
    pub bytes: u64,
    pub notes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    pub enabled: bool,
    /// Where archives are written, so the UI can offer to open it.
    pub directory: String,
    pub last: Option<BackupInfo>,
}

fn settings_path(dir: &Path) -> PathBuf {
    dir.join("settings.json")
}

#[derive(Serialize, Deserialize, Default)]
struct StoredSettings {
    enabled: Option<bool>,
}

/// Backups are on unless turned off. A missing or unreadable file means the
/// default, never an error — this must not be able to block a vault opening.
pub fn enabled(dir: &Path) -> bool {
    fs::read_to_string(settings_path(dir))
        .ok()
        .and_then(|raw| serde_json::from_str::<StoredSettings>(&raw).ok())
        .and_then(|value| value.enabled)
        .unwrap_or(true)
}

pub fn set_enabled(dir: &Path, value: bool) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let raw = serde_json::to_string_pretty(&StoredSettings {
        enabled: Some(value),
    })
    .map_err(|e| e.to_string())?;
    fs::write(settings_path(dir), raw).map_err(|e| e.to_string())
}

fn is_archive(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(PREFIX) && name.ends_with(SUFFIX))
}

fn info_for(path: &Path) -> Option<BackupInfo> {
    let meta = fs::metadata(path).ok()?;
    let created = meta
        .modified()
        .ok()
        .map(chrono::DateTime::<chrono::Utc>::from)
        .map(|t| t.to_rfc3339())
        .unwrap_or_default();
    Some(BackupInfo {
        path: path.display().to_string(),
        created,
        bytes: meta.len(),
        // Only known when the archive is written; listing does not open it.
        notes: 0,
    })
}

/// Every archive in `dir`, newest first.
pub fn list(dir: &Path) -> Vec<BackupInfo> {
    let mut out: Vec<BackupInfo> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && is_archive(path))
        .filter_map(|path| info_for(&path))
        .collect();
    out.sort_by(|a, b| b.created.cmp(&a.created));
    out
}

/// Delete all but the newest `KEEP` archives.
///
/// Only files this module named, only in the backup directory. Anything else
/// the user has put there is left alone.
fn rotate(dir: &Path) {
    for stale in list(dir).into_iter().skip(KEEP) {
        let path = PathBuf::from(&stale.path);
        if path.starts_with(dir) && is_archive(&path) {
            let _ = fs::remove_file(path);
        }
    }
}

/// Write a snapshot of `vault` into `dir`, returning what was written.
pub fn create(vault: &Vault, dir: &Path) -> Result<BackupInfo, String> {
    fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let final_path = dir.join(format!("{PREFIX}{stamp}{SUFFIX}"));
    // Build under a temporary name and rename at the end, so a crash midway
    // cannot leave something that looks like a usable archive.
    let temp_path = dir.join(format!("{PREFIX}{stamp}{SUFFIX}.partial"));

    let mut notes = 0usize;
    {
        let file =
            File::create(&temp_path).map_err(|e| format!("could not create the archive: {e}"))?;
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);

        for (note_type, path) in vault.scan() {
            // Store paths relative to the vault root, so an unzip reproduces
            // the prompts/ and ideas/ layout as-is.
            let relative = path.strip_prefix(&vault.root).unwrap_or(&path);
            let name = relative.to_string_lossy().replace('\\', "/");

            let body = match fs::read(&path) {
                Ok(body) => body,
                // One unreadable note must not cost the user the whole backup.
                Err(_) => continue,
            };
            zip.start_file(&name, options)
                .map_err(|e| format!("could not add {name}: {e}"))?;
            zip.write_all(&body)
                .map_err(|e| format!("could not write {name}: {e}"))?;
            notes += 1;
            let _ = note_type;
        }

        zip.start_file("README.txt", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(README.as_bytes())
            .map_err(|e| e.to_string())?;
        zip.finish()
            .map_err(|e| format!("could not finish the archive: {e}"))?;
    }

    fs::rename(&temp_path, &final_path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("could not finish the archive: {e}")
    })?;

    rotate(dir);

    let mut info = info_for(&final_path).ok_or("the archive vanished after being written")?;
    info.notes = notes;
    Ok(info)
}

/// Run a backup only if one is due — called when a vault opens, where the user
/// is not asking for anything and must not be made to wait often.
pub fn create_if_due(vault: &Vault, dir: &Path) -> Option<BackupInfo> {
    if !enabled(dir) {
        return None;
    }
    let due = match list(dir).first() {
        None => true,
        Some(latest) => chrono::DateTime::parse_from_rfc3339(&latest.created)
            .map(|t| {
                (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds()
                    >= MIN_INTERVAL_SECS as i64
            })
            .unwrap_or(true),
    };
    if !due {
        return None;
    }
    create(vault, dir).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway vault with two notes. Nothing here touches a real one.
    fn fixture() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path().to_path_buf()).unwrap();
        fs::write(vault.root.join("prompts/a.md"), "---\ntitle: A\n---\nbody a").unwrap();
        fs::write(vault.root.join("ideas/b.md"), "---\ntitle: B\n---\nbody b").unwrap();
        (dir, vault)
    }

    #[test]
    fn writes_an_archive_holding_every_note() {
        let (_guard, vault) = fixture();
        let out = tempfile::tempdir().unwrap();

        let info = create(&vault, out.path()).unwrap();

        assert_eq!(info.notes, 2);
        assert!(info.bytes > 0);
        let names: Vec<String> = {
            let file = File::open(&info.path).unwrap();
            let mut zip = zip::ZipArchive::new(file).unwrap();
            (0..zip.len())
                .map(|i| zip.by_index(i).unwrap().name().to_string())
                .collect()
        };
        assert!(names.contains(&"prompts/a.md".to_string()), "{names:?}");
        assert!(names.contains(&"ideas/b.md".to_string()), "{names:?}");
        assert!(names.contains(&"README.txt".to_string()), "{names:?}");
    }

    #[test]
    fn leaves_the_vault_exactly_as_it_found_it() {
        let (_guard, vault) = fixture();
        let out = tempfile::tempdir().unwrap();

        let before = crate::backup::tests::snapshot(&vault.root);
        create(&vault, out.path()).unwrap();
        let after = crate::backup::tests::snapshot(&vault.root);

        assert_eq!(before, after, "a backup must not alter the vault");
    }

    /// Every file under `root` with its bytes, for comparing before and after.
    fn snapshot(root: &Path) -> Vec<(String, Vec<u8>)> {
        let mut out: Vec<(String, Vec<u8>)> = walkdir::WalkDir::new(root)
            .into_iter()
            .flatten()
            .filter(|e| e.file_type().is_file())
            .map(|e| {
                (
                    e.path()
                        .strip_prefix(root)
                        .unwrap()
                        .display()
                        .to_string()
                        .replace('\\', "/"),
                    fs::read(e.path()).unwrap_or_default(),
                )
            })
            .collect();
        out.sort();
        out
    }

    /// The archive is only worth anything if it comes back out intact.
    #[test]
    fn an_archive_restores_byte_for_byte() {
        let (_guard, vault) = fixture();
        let out = tempfile::tempdir().unwrap();
        let info = create(&vault, out.path()).unwrap();

        let restored = tempfile::tempdir().unwrap();
        let file = File::open(&info.path).unwrap();
        zip::ZipArchive::new(file)
            .unwrap()
            .extract(restored.path())
            .unwrap();

        // The README is ours, not the user's; everything else must match.
        let _ = fs::remove_file(restored.path().join("README.txt"));

        let original = snapshot(&vault.root)
            .into_iter()
            .filter(|(name, _)| name.ends_with(".md"))
            .collect::<Vec<_>>();
        let recovered = snapshot(restored.path());

        assert_eq!(original, recovered, "a restore must reproduce every note");
    }

    #[test]
    fn rotation_keeps_only_its_own_files() {
        let out = tempfile::tempdir().unwrap();
        let bystander = out.path().join("holiday-photos.zip");
        fs::write(&bystander, b"not ours").unwrap();

        for i in 0..(KEEP + 5) {
            fs::write(
                out.path().join(format!("{PREFIX}2026010{i:02}-000000{SUFFIX}")),
                b"x",
            )
            .unwrap();
        }
        rotate(out.path());

        assert_eq!(list(out.path()).len(), KEEP);
        assert!(bystander.exists(), "rotation deleted an unrelated file");
    }

    #[test]
    fn a_second_run_is_skipped_until_the_interval_passes() {
        let (_guard, vault) = fixture();
        let out = tempfile::tempdir().unwrap();

        assert!(create_if_due(&vault, out.path()).is_some(), "first run");
        assert!(create_if_due(&vault, out.path()).is_none(), "too soon");
    }

    #[test]
    fn disabling_stops_the_automatic_run() {
        let (_guard, vault) = fixture();
        let out = tempfile::tempdir().unwrap();

        set_enabled(out.path(), false).unwrap();
        assert!(create_if_due(&vault, out.path()).is_none());
        assert!(list(out.path()).is_empty());
    }
}
