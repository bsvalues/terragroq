use url::Url;

pub const HERMES_ANCHOR_PROFILE: &str = "hermes-anchor";
pub const COUNTY_DEVELOPMENT_PROFILE: &str = "county-development";

pub struct NavigationPolicy {
    service_origin: String,
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

impl NavigationPolicy {
    pub fn new(configured_origin: &str) -> Result<Self, String> {
        Self::new_for_profile(configured_origin, HERMES_ANCHOR_PROFILE)
    }

    pub fn new_for_profile(configured_origin: &str, deployment_profile: &str) -> Result<Self, String> {
        let url = Url::parse(configured_origin)
            .map_err(|_| "WilliamOS service origin must be an absolute URL.".to_owned())?;
        let host = url
            .host_str()
            .ok_or_else(|| "WilliamOS service origin must include a host.".to_owned())?;
        let common_invalid = url.username() != ""
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
            || host.contains('*');
        if common_invalid {
            return Err("WilliamOS service origin must be one exact origin.".to_owned());
        }

        match deployment_profile {
            HERMES_ANCHOR_PROFILE => {
                if url.scheme() != "https" {
                    return Err("HERMES origin must be one exact HTTPS origin.".to_owned());
                }
            }
            COUNTY_DEVELOPMENT_PROFILE => {
                if url.scheme() != "http" || !is_loopback_host(host) || url.port().is_none() {
                    return Err(
                        "County Development origin must be one exact loopback HTTP origin with an explicit port."
                            .to_owned(),
                    );
                }
            }
            _ => return Err("WilliamOS deployment profile is invalid.".to_owned()),
        }

        Ok(Self {
            service_origin: url.origin().ascii_serialization(),
        })
    }

    pub fn allows(&self, candidate: &Url) -> bool {
        let origin = candidate.origin().ascii_serialization();
        origin == self.service_origin
            || (candidate.scheme() == "tauri" && candidate.host_str() == Some("localhost"))
            || origin == "http://tauri.localhost"
    }

    pub fn service_origin(&self) -> &str {
        &self.service_origin
    }

    pub fn hermes_origin(&self) -> &str {
        self.service_origin()
    }

    pub fn bootstrap_url(&self, startup_path: &str) -> Result<Url, String> {
        if startup_path != "/device-bootstrap" {
            return Err("Cockpit startup path is invalid.".to_owned());
        }
        Url::parse(&format!("{}{}", self.service_origin, startup_path))
            .map_err(|_| "Cockpit bootstrap URL is invalid.".to_owned())
    }
}
