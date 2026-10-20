use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use std::{
    env,
    error::Error,
    fs,
    path::{Component, Path, PathBuf},
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn main() -> Result<()> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    match args.as_slice() {
        [command, source, archive] if command == "pack" => {
            pack(Path::new(source), Path::new(archive))?;
            println!("Created updater-compatible archive; sign it before generating manifests.");
        }
        [command, archive] if command == "check" => {
            let temp = tempfile::tempdir()?;
            extract_for_updater(Path::new(archive), temp.path())?;
            println!("Updater archive passed Tauri macOS extraction.");
        }
        [command, archive, output] if command == "check" => {
            let output = Path::new(output);
            if output.exists() {
                return Err("Extraction output must not already exist".into());
            }
            let temp = tempfile::tempdir_in(output.parent().ok_or("Missing output parent")?)?;
            extract_for_updater(Path::new(archive), temp.path())?;
            fs::rename(temp.path(), output)?;
            println!("Extracted updater app: {}", output.display());
        }
        _ => {
            return Err("Usage: pack <app> <archive> | check <archive> [output.app]".into());
        }
    }
    Ok(())
}

fn pack(app: &Path, output: &Path) -> Result<()> {
    let name = app.file_name().ok_or("Missing app name")?;
    if app.extension().is_none_or(|extension| extension != "app") || !app.is_dir() {
        return Err("Source must be an .app directory".into());
    }
    let parent = output.parent().ok_or("Missing archive parent")?;
    let mut archive_file = tempfile::NamedTempFile::new_in(parent)?;
    {
        // Rust tar preserves bundle files, modes and symlinks without BSD tar's AppleDouble metadata.
        let encoder = GzEncoder::new(archive_file.as_file_mut(), Compression::default());
        let mut builder = tar::Builder::new(encoder);
        builder.follow_symlinks(false);
        builder.append_dir_all(name, app)?;
        builder.into_inner()?.finish()?;
    }
    let extracted = tempfile::tempdir()?;
    extract_for_updater(archive_file.path(), extracted.path())?;
    archive_file.persist(output)?;
    Ok(())
}

fn extract_for_updater(archive_path: &Path, destination: &Path) -> Result<()> {
    let decoder = GzDecoder::new(fs::File::open(archive_path)?);
    let mut archive = tar::Archive::new(decoder);
    let mut root = None;
    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        if !path
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        {
            return Err(format!("Invalid archive path: {}", path.display()).into());
        }
        let entry_root = path.components().next().ok_or("Empty archive path")?;
        if root.get_or_insert(entry_root.as_os_str().to_os_string()) != entry_root.as_os_str() {
            return Err("Updater archive must contain exactly one app root".into());
        }
        // Match tauri-plugin-updater's macOS install_inner: strip the app root, then unpack.
        let relative: PathBuf = path.iter().skip(1).collect();
        let extraction_path = destination.join(relative);
        if let Some(parent) = extraction_path.parent() {
            fs::create_dir_all(parent)?;
        }
        entry.unpack(extraction_path)?;
        if path
            .iter()
            .any(|part| part.to_string_lossy().starts_with("._") || part == "__MACOSX")
        {
            return Err(format!("Unexpected macOS metadata: {}", path.display()).into());
        }
    }
    if !destination.join("Contents/Info.plist").is_file() {
        return Err("Updater archive does not contain an app Info.plist".into());
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    fn app_fixture(parent: &Path) -> PathBuf {
        let app = parent.join("Margent.app");
        fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        fs::write(app.join("Contents/Info.plist"), "fixture").unwrap();
        fs::write(app.join("Contents/CodeResources"), "notarization ticket").unwrap();
        let executable = app.join("Contents/MacOS/Margent");
        fs::write(&executable, "executable").unwrap();
        fs::set_permissions(executable, fs::Permissions::from_mode(0o755)).unwrap();
        symlink("Margent", app.join("Contents/MacOS/alias")).unwrap();
        app
    }

    #[test]
    fn preserves_bundle_contents_permissions_and_symlinks() {
        let temp = tempfile::tempdir().unwrap();
        let app = app_fixture(temp.path());
        let archive = temp.path().join("app.tar.gz");
        pack(&app, &archive).unwrap();
        let output = tempfile::tempdir().unwrap();
        extract_for_updater(&archive, output.path()).unwrap();
        assert_eq!(
            fs::read_to_string(output.path().join("Contents/CodeResources")).unwrap(),
            "notarization ticket"
        );
        assert_eq!(
            fs::metadata(output.path().join("Contents/MacOS/Margent"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
        assert_eq!(
            fs::read_link(output.path().join("Contents/MacOS/alias")).unwrap(),
            Path::new("Margent")
        );
    }

    #[test]
    fn rejects_appledouble_root_with_the_updater_unpack_error() {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("bad.tar.gz");
        let mut builder = tar::Builder::new(GzEncoder::new(
            fs::File::create(&archive).unwrap(),
            Compression::default(),
        ));
        let mut header = tar::Header::new_gnu();
        header.set_size(8);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, "._Margent.app", &b"metadata"[..])
            .unwrap();
        builder.into_inner().unwrap().finish().unwrap();
        let output = tempfile::tempdir().unwrap();
        let error = extract_for_updater(&archive, output.path())
            .unwrap_err()
            .to_string();
        assert!(error.contains("failed to unpack `._Margent.app`"), "{error}");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn extended_attributes_do_not_create_appledouble_entries() {
        let temp = tempfile::tempdir().unwrap();
        let app = app_fixture(temp.path());
        let status = std::process::Command::new("/usr/bin/xattr")
            .args(["-w", "com.margent.updater-test", "metadata"])
            .arg(&app)
            .status()
            .unwrap();
        assert!(status.success());
        pack(&app, &temp.path().join("app.tar.gz")).unwrap();
    }

    #[test]
    fn rejects_nested_appledouble_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let app = app_fixture(temp.path());
        fs::write(app.join("Contents/._Info.plist"), "metadata").unwrap();
        assert!(pack(&app, &temp.path().join("app.tar.gz")).is_err());
        assert!(!temp.path().join("app.tar.gz").exists());
    }

    #[test]
    fn failed_pack_keeps_previous_archive() {
        let temp = tempfile::tempdir().unwrap();
        let app = app_fixture(temp.path());
        let archive = temp.path().join("app.tar.gz");
        fs::write(&archive, "previous archive").unwrap();
        fs::write(app.join("Contents/._Info.plist"), "metadata").unwrap();
        assert!(pack(&app, &archive).is_err());
        assert_eq!(fs::read_to_string(archive).unwrap(), "previous archive");
    }

    #[test]
    fn rejects_multiple_app_roots() {
        let temp = tempfile::tempdir().unwrap();
        let app = app_fixture(temp.path());
        let archive = temp.path().join("multiple.tar.gz");
        let mut builder = tar::Builder::new(GzEncoder::new(
            fs::File::create(&archive).unwrap(),
            Compression::default(),
        ));
        builder.append_dir_all("Margent.app", &app).unwrap();
        builder.append_dir_all("Other.app", &app).unwrap();
        builder.into_inner().unwrap().finish().unwrap();
        let output = tempfile::tempdir().unwrap();
        let error = extract_for_updater(&archive, output.path())
            .unwrap_err()
            .to_string();
        assert!(error.contains("exactly one app root"), "{error}");
    }

    #[test]
    fn rejects_empty_archives() {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("empty.tar.gz");
        tar::Builder::new(GzEncoder::new(
            fs::File::create(&archive).unwrap(),
            Compression::default(),
        ))
        .into_inner()
        .unwrap()
        .finish()
        .unwrap();
        let output = tempfile::tempdir().unwrap();
        assert!(extract_for_updater(&archive, output.path()).is_err());
    }
}
