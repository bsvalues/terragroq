use url::Url;

pub struct NavigationPolicy {
    hermes_origin: String,
}

impl NavigationPolicy {
    pub fn new(configured_origin: &str) -> Result<Self, String> {
        let url = Url::parse(configured_origin)
            .map_err(|_| "HERMES origin must be an absolute URL.".to_owned())?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || url.username() != ""
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
            || url.host_str().is_some_and(|host| host.contains('*'))
        {
            return Err("HERMES origin must be one exact HTTPS origin.".to_owned());
        }

        Ok(Self {
            hermes_origin: url.origin().ascii_serialization(),
        })
    }

    pub fn allows(&self, candidate: &Url) -> bool {
        let origin = candidate.origin().ascii_serialization();
        origin == self.hermes_origin
            || (candidate.scheme() == "tauri" && candidate.host_str() == Some("localhost"))
            || origin == "http://tauri.localhost"
    }

    pub fn hermes_origin(&self) -> &str {
        &self.hermes_origin
    }

    pub fn bootstrap_url(&self, startup_path: &str) -> Result<Url, String> {
        if startup_path != "/device-bootstrap" { return Err("Cockpit startup path is invalid.".to_owned()); }
        Url::parse(&format!("{}{}", self.hermes_origin, startup_path))
            .map_err(|_| "Cockpit bootstrap URL is invalid.".to_owned())
    }
}
