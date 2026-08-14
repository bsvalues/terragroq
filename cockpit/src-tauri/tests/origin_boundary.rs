use url::Url;
use williamos_cockpit::origin::NavigationPolicy;

#[test]
fn permits_only_local_recovery_and_the_exact_https_hermes_origin() {
    let policy = NavigationPolicy::new("https://hermes.williamos.local").unwrap();

    assert!(policy.allows(&Url::parse("tauri://localhost/").unwrap()));
    assert!(policy.allows(&Url::parse("https://hermes.williamos.local/projects").unwrap()));
    assert!(!policy.allows(&Url::parse("http://hermes.williamos.local/").unwrap()));
    assert!(!policy.allows(&Url::parse("https://evil.example/").unwrap()));
    assert!(!policy.allows(&Url::parse("https://hermes.williamos.local.evil.example/").unwrap()));
    assert!(!policy.allows(&Url::parse("file:///C:/Windows/System32/").unwrap()));
}

#[test]
fn rejects_non_origin_and_non_https_configuration() {
    assert!(NavigationPolicy::new("http://hermes.williamos.local").is_err());
    assert!(NavigationPolicy::new("https://hermes.williamos.local/path").is_err());
    assert!(NavigationPolicy::new("https://*.williamos.local").is_err());
}
