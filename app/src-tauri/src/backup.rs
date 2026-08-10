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

/// How many snapshots to keep by default. Markdown compresses to almost
/// nothing, so this is generous; the user can raise or lower it in settings.
const DEFAULT_KEEP: usize = 12;

/// How long to wait between automatic snapshots by default.
const DEFAULT_INTERVAL_MINUTES: u64 = 60;

/// The settings panel's allowed ranges, so a stray value cannot fill the disk
/// with archives or silently stop the automatic run.
const MIN_KEEP: usize = 1;
const MAX_KEEP: usize = 100;
const MIN_INTERVAL_MINUTES: u64 = 5;
const MAX_INTERVAL_MINUTES: u64 = 7 * 24 * 60;

const README: &str = "\
This is a sudonotes vault backup.

Despite the .bak extension it is an ordinary ZIP archive: rename it to .zip to
open it in Explorer, Finder or any unzip tool. Inside you will find the
prompts/ and ideas/ folders exactly as they were in the vault.

To restore, unzip it over the folder to become the vault. Any notes already in
that folder are saved as another backup first, then replaced. Nothing else in
the archive is required.
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
    /// How many archives to keep, oldest first; older ones are rotated away.
    pub keep: usize,
    /// Minimum minutes between automatic snapshots.
    pub interval_minutes: u64,
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
    keep: Option<usize>,
    interval_minutes: Option<u64>,
}

/// A missing or unreadable file means the defaults, never an error — settings
/// must not be able to block a vault opening.
fn load(dir: &Path) -> StoredSettings {
    fs::read_to_string(settings_path(dir))
        .ok()
        .and_then(|raw| serde_json::from_str::<StoredSettings>(&raw).ok())
        .unwrap_or_default()
}

fn save(dir: &Path, settings: &StoredSettings) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(settings_path(dir), raw).map_err(|e| e.to_string())
}

/// Backups are on unless turned off.
pub fn enabled(dir: &Path) -> bool {
    load(dir).enabled.unwrap_or(true)
}

pub fn set_enabled(dir: &Path, value: bool) -> Result<(), String> {
    let mut settings = load(dir);
    settings.enabled = Some(value);
    save(dir, &settings)
}

pub fn keep_count(dir: &Path) -> usize {
    load(dir)
        .keep
        .unwrap_or(DEFAULT_KEEP)
        .clamp(MIN_KEEP, MAX_KEEP)
}

pub fn interval_minutes(dir: &Path) -> u64 {
    load(dir)
        .interval_minutes
        .unwrap_or(DEFAULT_INTERVAL_MINUTES)
        .clamp(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)
}

pub fn set_retention(dir: &Path, keep: usize, interval_minutes: u64) -> Result<(), String> {
    let mut settings = load(dir);
    settings.keep = Some(keep.clamp(MIN_KEEP, MAX_KEEP));
    settings.interval_minutes = Some(interval_minutes.clamp(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES));
    save(dir, &settings)
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

/// Delete all but the newest `keep` archives.
///
/// Only files this module named, only in the backup directory. Anything else
/// the user has put there is left alone.
fn rotate(dir: &Path, keep: usize) {
    for stale in list(dir).into_iter().skip(keep) {
        let path = PathBuf::from(&stale.path);
        if path.starts_with(dir) && is_archive(&path) {
            let _ = fs::remove_file(path);
        }
    }
}

/// Write a snapshot of `vault` into `dir`, returning what was written.
pub fn create(vault: &Vault, dir: &Path) -> Result<BackupInfo, String> {
    write_snapshot(&vault.root, dir)
}

/// Zip every note under `root` (a `prompts/` + `ideas/` layout) into `dir`.
fn write_snapshot(root: &Path, dir: &Path) -> Result<BackupInfo, String> {
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

        let vault = Vault {
            root: root.to_path_buf(),
        };
        for (note_type, path) in vault.scan() {
            // Store paths relative to the vault root, so an unzip reproduces
            // the prompts/ and ideas/ layout as-is.
            let relative = path.strip_prefix(root).unwrap_or(&path);
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

    rotate(dir, keep_count(dir));

    let mut info = info_for(&final_path).ok_or("the archive vanished after being written")?;
    info.notes = notes;
    Ok(info)
}

/// Reject anything that would escape the destination.
///
/// A zip entry's name comes from the archive, not from us, so an entry called
/// `../../notes.md` would otherwise be written outside the folder the user
/// chose. Absolute paths, drive prefixes and `..` segments are all refused
/// rather than sanitised, because a legitimate sudonotes archive never has any.
fn safe_entry_path(name: &str) -> Option<PathBuf> {
    if name.is_empty() || name.ends_with('/') {
        return None;
    }
    let mut out = PathBuf::new();
    for part in name.split(['/', '\\']) {
        match part {
            "" | "." => continue,
            ".." => return None,
            _ => {
                if part.contains(':') {
                    return None;
                }
                out.push(part);
            }
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Unpack an archive into `dest`, returning how many notes were written.
///
/// `dest` may already hold a vault. Overwriting is destructive, so before
/// anything is replaced the folder's current notes are snapshotted into
/// `safety_dir` (the app's backup directory), giving the restore a way back.
pub fn restore(archive: &Path, dest: &Path, safety_dir: &Path) -> Result<usize, String> {
    let file = File::open(archive).map_err(|e| format!("could not open the archive: {e}"))?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|e| format!("that file is not a backup archive: {e}"))?;

    // The folder is about to be overwritten, so its current notes go to the
    // backup directory first. Empty or absent folders have nothing to protect.
    let occupied = dest.exists()
        && fs::read_dir(dest).is_ok_and(|mut entries| entries.next().is_some());
    if occupied {
        write_snapshot(dest, safety_dir)
            .map_err(|e| format!("could not back up the existing folder first: {e}"))?;
    }

    fs::create_dir_all(dest).map_err(|e| format!("could not create {}: {e}", dest.display()))?;

    let mut restored = 0usize;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        // Ours, not the user's — it would only litter the restored vault.
        if name == "README.txt" {
            continue;
        }
        let Some(relative) = safe_entry_path(&name) else {
            continue;
        };
        let target = dest.join(&relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("could not create a folder: {e}"))?;
        }
        let mut out =
            File::create(&target).map_err(|e| format!("could not write {}: {e}", target.display()))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("could not write a note: {e}"))?;
        restored += 1;
    }

    Ok(restored)
}

/// Run a backup only if one is due — called when a vault opens, where the user
/// is not asking for anything and must not be made to wait often.
pub fn create_if_due(vault: &Vault, dir: &Path) -> Option<BackupInfo> {
    if !enabled(dir) {
        return None;
    }
    let interval_secs = interval_minutes(dir) * 60;
    let due = match list(dir).first() {
        None => true,
        Some(latest) => chrono::DateTime::parse_from_rfc3339(&latest.created)
            .map(|t| {
                (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds()
                    >= interval_secs as i64
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
    fn restore_round_trips_a_vault() {
        let (_guard, vault) = fixture();
        let out = tempfile::tempdir().unwrap();
        let info = create(&vault, out.path()).unwrap();

        let into = tempfile::tempdir().unwrap();
        let safety = tempfile::tempdir().unwrap();
        let dest = into.path().join("recovered");
        let count = restore(Path::new(&info.path), &dest, safety.path()).unwrap();

        assert_eq!(count, 2);
        assert_eq!(
            snapshot(&vault.root)
                .into_iter()
                .filter(|(n, _)| n.ends_with(".md"))
                .collect::<Vec<_>>(),
            snapshot(&dest)
        );
    }

    /// Restoring over a folder that already holds notes must not destroy them:
    /// the folder's notes are snapshotted first, then replaced by the archive.
    #[test]
    fn restore_overwrites_but_first_backs_up_the_folder() {
        let (_guard, vault) = fixture();
        let out = tempfile::tempdir().unwrap();
        let info = create(&vault, out.path()).unwrap();

        let occupied = tempfile::tempdir().unwrap();
        let safety = tempfile::tempdir().unwrap();
        // Same path as an archived note, holding different content.
        fs::create_dir(occupied.path().join("ideas")).unwrap();
        fs::write(occupied.path().join("ideas/b.md"), b"old notes").unwrap();

        let count = restore(Path::new(&info.path), occupied.path(), safety.path()).unwrap();

        assert_eq!(count, 2);
        assert_eq!(
            fs::read(occupied.path().join("ideas/b.md")).unwrap(),
            b"---\ntitle: B\n---\nbody b",
            "the archived note replaced the one already there"
        );
        assert_eq!(
            fs::read(occupied.path().join("prompts/a.md")).unwrap(),
            b"---\ntitle: A\n---\nbody a",
        );
        let saved = list(safety.path());
        assert_eq!(saved.len(), 1, "the old folder was snapshotted first");
        let mut saved_zip = zip::ZipArchive::new(File::open(&saved[0].path).unwrap()).unwrap();
        let old = saved_zip.by_name("ideas/b.md").unwrap();
        let mut old_body = Vec::new();
        std::io::copy(&mut std::io::BufReader::new(old), &mut old_body).unwrap();
        assert_eq!(old_body, b"old notes", "the overwritten note is in the safety backup");
    }

    /// An archive naming an entry `../escaped.md` must not write above `dest`.
    #[test]
    fn restore_refuses_to_escape_the_destination() {
        assert_eq!(safe_entry_path("prompts/a.md"), Some(PathBuf::from("prompts/a.md")));
        assert_eq!(safe_entry_path("../escaped.md"), None);
        assert_eq!(safe_entry_path("prompts/../../escaped.md"), None);
        assert_eq!(safe_entry_path("/etc/passwd"), Some(PathBuf::from("etc/passwd")));
        assert_eq!(safe_entry_path("C:\\Windows\\evil.md"), None);
        assert_eq!(safe_entry_path(""), None);
    }

    #[test]
    fn rotation_keeps_only_its_own_files() {
        let out = tempfile::tempdir().unwrap();
        let bystander = out.path().join("holiday-photos.zip");
        fs::write(&bystander, b"not ours").unwrap();

        for i in 0..(DEFAULT_KEEP + 5) {
            fs::write(
                out.path().join(format!("{PREFIX}2026010{i:02}-000000{SUFFIX}")),
                b"x",
            )
            .unwrap();
        }
        rotate(out.path(), DEFAULT_KEEP);

        assert_eq!(list(out.path()).len(), DEFAULT_KEEP);
        assert!(bystander.exists(), "rotation deleted an unrelated file");
    }

    #[test]
    fn rotation_respects_the_configured_keep_count() {
        let out = tempfile::tempdir().unwrap();
        for i in 0..10 {
            fs::write(
                out.path().join(format!("{PREFIX}2026010{i:02}-000000{SUFFIX}")),
                b"x",
            )
            .unwrap();
        }
        set_retention(out.path(), 3, 60).unwrap();

        // `create` rotates with the stored value; force it through the real path.
        assert_eq!(keep_count(out.path()), 3);
        assert_eq!(interval_minutes(out.path()), 60);
        let (_guard, vault) = fixture();
        create(&vault, out.path()).unwrap();
        assert_eq!(list(out.path()).len(), 3);
    }

    #[test]
    fn retention_defaults_and_clamps() {
        let dir = tempfile::tempdir().unwrap();
        // Nothing stored: defaults.
        assert_eq!(keep_count(dir.path()), DEFAULT_KEEP);
        assert_eq!(interval_minutes(dir.path()), DEFAULT_INTERVAL_MINUTES);
        // Out-of-range values are clamped, and a vault opening can never fail
        // because of a bad settings file.
        set_retention(dir.path(), 0, 0).unwrap();
        assert_eq!(keep_count(dir.path()), MIN_KEEP);
        assert_eq!(interval_minutes(dir.path()), MIN_INTERVAL_MINUTES);
        set_retention(dir.path(), 10_000, 10_000_000).unwrap();
        assert_eq!(keep_count(dir.path()), MAX_KEEP);
        assert_eq!(interval_minutes(dir.path()), MAX_INTERVAL_MINUTES);
        fs::write(settings_path(dir.path()), b"{").unwrap();
        assert_eq!(keep_count(dir.path()), DEFAULT_KEEP);
        assert_eq!(interval_minutes(dir.path()), DEFAULT_INTERVAL_MINUTES);
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
