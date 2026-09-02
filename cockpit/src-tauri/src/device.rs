use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::SysRng;
use rand::TryRng;
use serde::Serialize;
use url::Host;
use zeroize::Zeroizing;

const PRIVATE_KEY_ENTRY: &str = "device-ed25519-pkcs8";
const CREDENTIAL_ID_ENTRY: &str = "device-credential-id";
const MAX_CREDENTIAL_ID_BYTES: usize = 80;
const MAX_PROOF_BYTES: usize = 512;

pub trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, String>;
    fn put(&self, name: &str, secret: &[u8]) -> Result<(), String>;
}

pub struct WindowsCredentialStore;

impl WindowsCredentialStore {
    const SERVICE: &'static str = "com.williamos.cockpit";

    fn entry(name: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(Self::SERVICE, name)
            .map_err(|_| "OS credential store is unavailable.".to_owned())
    }
}

impl SecretStore for WindowsCredentialStore {
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, String> {
        let entry = Self::entry(name)?;
        match entry.get_secret() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("OS credential store read failed.".to_owned()),
        }
    }

    fn put(&self, name: &str, secret: &[u8]) -> Result<(), String> {
        Self::entry(name)?
            .set_secret(secret)
            .map_err(|_| "OS credential store write failed.".to_owned())
    }
}

pub struct DeviceProofService<'a, S: SecretStore> {
    store: &'a S,
    hermes_origin: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicKeyResponse {
    pub public_key_spki: String,
}

#[derive(Debug, Serialize)]
pub struct SignatureResponse {
    pub signature: String,
}

impl<'a, S: SecretStore> DeviceProofService<'a, S> {
    pub fn new(store: &'a S, hermes_origin: &'a str) -> Self {
        Self { store, hermes_origin }
    }

    pub fn generate_key(&self) -> Result<PublicKeyResponse, String> {
        let signing_key = match self.store.get(PRIVATE_KEY_ENTRY)? {
            Some(pkcs8) => decode_private_key(pkcs8)?,
            None => {
                let mut seed = Zeroizing::new([0_u8; 32]);
                SysRng
                    .try_fill_bytes(seed.as_mut())
                    .map_err(|_| "Secure device key generation failed.".to_owned())?;
                let key = SigningKey::from_bytes(&seed);
                let document = key
                    .to_pkcs8_der()
                    .map_err(|_| "Device key encoding failed.".to_owned())?;
                self.store.put(PRIVATE_KEY_ENTRY, document.as_bytes())?;
                key
            }
        };

        public_key_response(&signing_key)
    }

    pub fn bind_credential(&self, credential_id: &str) -> Result<(), String> {
        let length = credential_id.as_bytes().len();
        if !(20..=MAX_CREDENTIAL_ID_BYTES).contains(&length)
            || !credential_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err("Credential identifier is invalid.".to_owned());
        }
        self.store.put(CREDENTIAL_ID_ENTRY, credential_id.as_bytes())
    }

    pub fn credential(&self) -> Result<Option<String>, String> {
        let Some(bytes) = self.store.get(CREDENTIAL_ID_ENTRY)? else {
            return Ok(None);
        };
        String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "Stored credential identifier is invalid.".to_owned())
    }

    pub fn sign(&self, proof: &str) -> Result<SignatureResponse, String> {
        let length = proof.as_bytes().len();
        if length == 0 || length > MAX_PROOF_BYTES || !canonical_proof_shape(proof, self.hermes_origin) {
            return Err("Canonical proof is invalid.".to_owned());
        }
        let pkcs8 = self
            .store
            .get(PRIVATE_KEY_ENTRY)?
            .ok_or_else(|| "Device key is not enrolled.".to_owned())?;
        let signing_key = decode_private_key(pkcs8)?;
        let signature = signing_key.sign(proof.as_bytes());
        Ok(SignatureResponse {
            signature: URL_SAFE_NO_PAD.encode(signature.to_bytes()),
        })
    }
}

fn canonical_proof_shape(proof: &str, hermes_origin: &str) -> bool {
    let lines: Vec<&str> = proof.split('\n').collect();
    if lines.len() != 6
        || lines[0] != "williamos-device-auth-v1"
        || !matches!(lines[1], "purpose=enroll" | "purpose=authenticate")
        || !lines[2].starts_with("requestId=")
        || lines[2].len() != 46
        || !lines[3].starts_with("challenge=")
        || lines[3].len() != 53
    {
        return false;
    }
    let challenge = &lines[3][10..];
    let request_id = &lines[2][10..];
    let Some(origin_value) = lines[4].strip_prefix("origin=") else { return false; };
    let Some(expiry_value) = lines[5].strip_prefix("expiresAt=") else { return false; };
    let Ok(origin) = url::Url::parse(origin_value) else { return false; };
    let Ok(expiry) = time::OffsetDateTime::parse(expiry_value, &time::format_description::well_known::Rfc3339) else { return false; };
    request_id.bytes().all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        && challenge.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        && proof_origin_is_authorized(&origin)
        && origin.origin().ascii_serialization() == hermes_origin
        && origin_value == hermes_origin
        && expiry > time::OffsetDateTime::now_utc()
}

fn proof_origin_is_authorized(origin: &url::Url) -> bool {
    if origin.scheme() == "https" {
        return true;
    }
    if origin.scheme() != "http" {
        return false;
    }
    match origin.host() {
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        None => false,
    }
}

fn decode_private_key(pkcs8: Vec<u8>) -> Result<SigningKey, String> {
    let secret = Zeroizing::new(pkcs8);
    SigningKey::from_pkcs8_der(secret.as_slice())
        .map_err(|_| "Stored device key is invalid.".to_owned())
}

fn public_key_response(signing_key: &SigningKey) -> Result<PublicKeyResponse, String> {
    let document = signing_key
        .verifying_key()
        .to_public_key_der()
        .map_err(|_| "Public key encoding failed.".to_owned())?;
    Ok(PublicKeyResponse {
        public_key_spki: URL_SAFE_NO_PAD.encode(document.as_bytes()),
    })
}
