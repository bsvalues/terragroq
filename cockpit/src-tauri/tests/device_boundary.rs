use std::collections::HashMap;
use std::sync::Mutex;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::pkcs8::DecodePublicKey;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use williamos_cockpit::device::{DeviceProofService, SecretStore};

const HERMES_ORIGIN: &str = "https://hermes.williamos.local";
const COUNTY_ORIGIN: &str = "http://127.0.0.1:3200";
const VALID_PROOF: &str = "williamos-device-auth-v1\npurpose=authenticate\nrequestId=123e4567-e89b-42d3-a456-426614174000\nchallenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\norigin=https://hermes.williamos.local\nexpiresAt=2099-08-14T12:00:00Z";
const VALID_COUNTY_PROOF: &str = "williamos-device-auth-v1\npurpose=authenticate\nrequestId=123e4567-e89b-42d3-a456-426614174000\nchallenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\norigin=http://127.0.0.1:3200\nexpiresAt=2099-08-14T12:00:00Z";

#[derive(Default)]
struct MemoryStore {
    values: Mutex<HashMap<String, Vec<u8>>>,
}

impl SecretStore for MemoryStore {
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, String> {
        Ok(self.values.lock().unwrap().get(name).cloned())
    }

    fn put(&self, name: &str, secret: &[u8]) -> Result<(), String> {
        self.values
            .lock()
            .unwrap()
            .insert(name.to_owned(), secret.to_vec());
        Ok(())
    }
}

#[test]
fn generates_one_persistent_key_and_returns_only_public_spki() {
    let store = MemoryStore::default();
    let service = DeviceProofService::new(&store, HERMES_ORIGIN);

    let first = service.generate_key().unwrap();
    let second = service.generate_key().unwrap();
    let serialized = serde_json::to_string(&first).unwrap();

    expect_public_spki(&first.public_key_spki);
    assert_eq!(first.public_key_spki, second.public_key_spki);
    assert_eq!(store.values.lock().unwrap().len(), 1);
    assert!(!serialized.to_ascii_lowercase().contains("private"));
    assert!(!serialized.to_ascii_lowercase().contains("pkcs8"));
}

#[test]
fn stores_and_recovers_only_the_opaque_credential_id() {
    let store = MemoryStore::default();
    let service = DeviceProofService::new(&store, HERMES_ORIGIN);

    assert_eq!(service.credential().unwrap(), None);
    service.bind_credential("cred_01J7HERMES-primary").unwrap();
    assert_eq!(
        service.credential().unwrap().as_deref(),
        Some("cred_01J7HERMES-primary"),
    );
}

#[test]
fn signs_the_exact_server_proof_without_returning_key_material() {
    let store = MemoryStore::default();
    let service = DeviceProofService::new(&store, HERMES_ORIGIN);
    let public = service.generate_key().unwrap();
    let proof = VALID_PROOF;

    let signed = service.sign(proof).unwrap();
    let public_der = URL_SAFE_NO_PAD.decode(public.public_key_spki).unwrap();
    let verifying_key = VerifyingKey::from_public_key_der(&public_der).unwrap();
    let signature_bytes = URL_SAFE_NO_PAD.decode(&signed.signature).unwrap();
    let signature = Signature::from_slice(&signature_bytes).unwrap();

    verifying_key.verify(proof.as_bytes(), &signature).unwrap();
    assert_eq!(serde_json::to_value(signed).unwrap().as_object().unwrap().len(), 1);
}

#[test]
fn signs_the_exact_county_loopback_http_proof() {
    let store = MemoryStore::default();
    let service = DeviceProofService::new(&store, COUNTY_ORIGIN);
    let public = service.generate_key().unwrap();

    let signed = service.sign(VALID_COUNTY_PROOF).unwrap();
    let public_der = URL_SAFE_NO_PAD.decode(public.public_key_spki).unwrap();
    let verifying_key = VerifyingKey::from_public_key_der(&public_der).unwrap();
    let signature_bytes = URL_SAFE_NO_PAD.decode(&signed.signature).unwrap();
    let signature = Signature::from_slice(&signature_bytes).unwrap();

    verifying_key.verify(VALID_COUNTY_PROOF.as_bytes(), &signature).unwrap();
}

#[test]
fn rejects_empty_or_oversized_proofs_and_credential_ids() {
    let store = MemoryStore::default();
    let service = DeviceProofService::new(&store, HERMES_ORIGIN);

    assert!(service.sign("").is_err());
    assert!(service.sign(&"x".repeat(513)).is_err());
    assert!(service.sign("arbitrary signing oracle input").is_err());
    assert!(service.sign(&VALID_PROOF.replace("purpose=authenticate", "purpose=execute")).is_err());
    assert!(service.sign(&VALID_PROOF.replace(HERMES_ORIGIN, "https://evil.example")).is_err());
    assert!(service.sign(&VALID_PROOF.replace("2099-08-14T12:00:00Z", "2020-01-01T00:00:00Z")).is_err());
    assert!(service.bind_credential("").is_err());
    assert!(service.bind_credential(&"x".repeat(19)).is_err());
    assert!(service.bind_credential(&"x".repeat(81)).is_err());
    assert!(service.bind_credential("not+base64url-credential").is_err());
}

#[test]
fn rejects_non_loopback_http_even_when_it_matches_the_configured_origin() {
    let store = MemoryStore::default();
    let service = DeviceProofService::new(&store, "http://county.example:3200");
    let proof = VALID_COUNTY_PROOF.replace("http://127.0.0.1:3200", "http://county.example:3200");
    service.generate_key().unwrap();

    assert!(service.sign(&proof).is_err());
}

fn expect_public_spki(encoded: &str) {
    let der = URL_SAFE_NO_PAD.decode(encoded).unwrap();
    VerifyingKey::from_public_key_der(&der).unwrap();
}
