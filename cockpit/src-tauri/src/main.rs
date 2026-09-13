#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use tauri::webview::NewWindowResponse;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use williamos_cockpit::device::{
    DeviceProofService, PublicKeyResponse, SignatureResponse, WindowsCredentialStore,
};
use williamos_cockpit::origin::NavigationPolicy;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CockpitConfig {
    #[serde(alias = "hermesOrigin")]
    service_origin: String,
    #[serde(default = "default_deployment_profile")]
    deployment_profile: String,
    startup_path: String,
}

fn default_deployment_profile() -> String {
    "hermes-anchor".to_owned()
}

fn embedded_config() -> Result<&'static str, String> {
    match option_env!("WILLIAMOS_COCKPIT_PROFILE").unwrap_or("hermes-anchor") {
        "hermes-anchor" => Ok(include_str!("../../cockpit.config.json")),
        "county-development" => Ok(include_str!("../../county-development.config.json")),
        other => Err(format!("Unsupported Cockpit build profile: {other}")),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialResponse {
    credential_id: String,
}

struct CockpitState {
    service_origin: String,
}

#[tauri::command]
fn device_generate_key(state: tauri::State<'_, CockpitState>) -> Result<PublicKeyResponse, String> {
    DeviceProofService::new(&WindowsCredentialStore, &state.service_origin).generate_key()
}

#[tauri::command(rename_all = "camelCase")]
fn device_bind_credential(
    state: tauri::State<'_, CockpitState>,
    credential_id: String,
) -> Result<(), String> {
    DeviceProofService::new(&WindowsCredentialStore, &state.service_origin)
        .bind_credential(&credential_id)
}

#[tauri::command]
fn device_credential(
    state: tauri::State<'_, CockpitState>,
) -> Result<Option<CredentialResponse>, String> {
    DeviceProofService::new(&WindowsCredentialStore, &state.service_origin)
        .credential()
        .map(|credential| credential.map(|credential_id| CredentialResponse { credential_id }))
}

#[tauri::command]
fn device_sign(
    state: tauri::State<'_, CockpitState>,
    proof: String,
) -> Result<SignatureResponse, String> {
    DeviceProofService::new(&WindowsCredentialStore, &state.service_origin).sign(&proof)
}

fn main() {
    let Ok(instance_guard) = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 47_862))
    else {
        return;
    };
    let run_result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let config: CockpitConfig = serde_json::from_str(embedded_config()?)
                .map_err(|error| format!("Cockpit configuration is invalid: {error}"))?;
            let policy = NavigationPolicy::new_for_profile(
                &config.service_origin,
                &config.deployment_profile,
            )?;
            app.manage(CockpitState {
                service_origin: policy.service_origin().to_owned(),
            });

            let bootstrap_url = policy.bootstrap_url(&config.startup_path)?;
            let title = if config.deployment_profile == "county-development" {
                "WilliamOS County Development"
            } else {
                "WilliamOS Cockpit"
            };
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(bootstrap_url))
                .title(title)
                .inner_size(1440.0, 940.0)
                .min_inner_size(960.0, 640.0)
                .devtools(false)
                .on_navigation(move |url| policy.allows(url))
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            device_generate_key,
            device_bind_credential,
            device_credential,
            device_sign,
        ])
        .run(tauri::generate_context!());
    drop(instance_guard);
    run_result.expect("WilliamOS Cockpit runtime failed");
}
