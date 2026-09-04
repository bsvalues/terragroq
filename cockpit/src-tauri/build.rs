fn main() {
    // GNU Rust on Windows needs MinGW tools (C preprocessor, windres) when Tauri compiles the
    // application resource. Prepend the resolved tool directories to the inherited PATH instead
    // of replacing PATH: the previous replacement narrowed the build-script PATH to a single
    // hardcoded MinGW directory plus System32, which on GitHub's windows-2022 image leaves no
    // windres.exe reachable and aborts the build with embed-resource NotAttempted("windres").
    let mut prepend: Vec<std::path::PathBuf> = Vec::new();
    if let Some(bin) = std::env::var_os("WILLIAMOS_WINDRES_BIN") {
        prepend.push(bin.into());
    }
    if let Some(bin) = std::env::var_os("WILLIAMOS_MINGW_BIN") {
        prepend.push(bin.into());
    }
    prepend.push(std::path::PathBuf::from(r"C:\msys64\mingw64\bin"));
    prepend.retain(|path| path.is_dir());
    for path in &prepend {
        println!("cargo:warning=WINDRES_DIAG_RS prepend {}", path.display());
    }
    if !prepend.is_empty() {
        let mut joined_dirs = prepend.clone();
        for entry in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
            joined_dirs.push(entry);
        }
        if let Ok(joined) = std::env::join_paths(&joined_dirs) {
            unsafe { std::env::set_var("PATH", joined) };
        }
    }
    // Ground-truth probe for the CI windres failures: spawn windres exactly the way
    // embed-resource's is_runnable check does and report the outcome either way.
    match std::process::Command::new("windres")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|mut child| child.kill())
    {
        Ok(_) => println!("cargo:warning=WINDRES_DIAG_RS spawn-ok windres"),
        Err(error) => println!(
            "cargo:warning=WINDRES_DIAG_RS spawn-fail windres: {error} os={:?}",
            error.raw_os_error()
        ),
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
