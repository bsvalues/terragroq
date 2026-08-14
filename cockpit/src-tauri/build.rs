fn main() {
    // GNU Rust on Windows needs MinGW's C preprocessor when Tauri compiles the
    // application resource. This changes only the build-script child PATH.
    let mingw = r"C:\msys64\mingw64\bin";
    if std::path::Path::new(mingw).is_dir() {
        let paths = [std::path::PathBuf::from(mingw), std::path::PathBuf::from(r"C:\Windows\System32")];
        if let Ok(joined) = std::env::join_paths(paths) {
            unsafe { std::env::set_var("PATH", joined) };
        }
    }
    let manifest = tauri_build::AppManifest::new().commands(&[
        "device_generate_key",
        "device_bind_credential",
        "device_credential",
        "device_sign",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to build WilliamOS Cockpit");
}
