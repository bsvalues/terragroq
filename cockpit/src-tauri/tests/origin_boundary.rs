use url::Url;
use williamos_cockpit::origin::{
    NavigationPolicy, COUNTY_DEVELOPMENT_PROFILE, HERMES_ANCHOR_PROFILE,
};

#[test]
fn permits_only_local_recovery_and_the_exact_https_hermes_origin() {
    let policy = NavigationPolicy::new_for_profile(
        "https://hermes.williamos.local",
        HERMES_ANCHOR_PROFILE,
    )
    .unwrap();

    assert!(policy.allows(&Url::parse("tauri://localhost/").unwrap()));
    assert!(policy.allows(&Url::parse("https://hermes.williamos.local/projects").unwrap()));
    assert!(!policy.allows(&Url::parse("http://hermes.williamos.local/").unwrap()));
    assert!(!policy.allows(&Url::parse("https://evil.example/").unwrap()));
    assert!(!policy.allows(&Url::parse("https://hermes.williamos.local.evil.example/").unwrap()));
    assert!(!policy.allows(&Url::parse("file:///C:/Windows/System32/").unwrap()));
}

#[test]
fn county_profile_permits_only_the_exact_loopback_http_origin() {
    let policy = NavigationPolicy::new_for_profile(
        "http://127.0.0.1:3200",
        COUNTY_DEVELOPMENT_PROFILE,
    )
    .unwrap();

    assert!(policy.allows(&Url::parse("http://127.0.0.1:3200/device-bootstrap").unwrap()));
    assert!(!policy.allows(&Url::parse("http://127.0.0.1:3201/").unwrap()));
    assert!(!policy.allows(&Url::parse("http://192.168.88.9:3200/").unwrap()));
    assert!(!policy.allows(&Url::parse("https://127.0.0.1:3200/").unwrap()));
    assert!(!policy.allows(&Url::parse("file:///C:/Windows/System32/").unwrap()));
}

#[test]
fn rejects_non_origin_or_wrong_transport_for_each_profile() {
    assert!(NavigationPolicy::new("http://hermes.williamos.local").is_err());
    assert!(NavigationPolicy::new("https://hermes.williamos.local/path").is_err());
    assert!(NavigationPolicy::new("https://*.williamos.local").is_err());
    assert!(NavigationPolicy::new_for_profile(
        "https://127.0.0.1:3200",
        COUNTY_DEVELOPMENT_PROFILE,
    )
    .is_err());
    assert!(NavigationPolicy::new_for_profile(
        "http://county.example:3200",
        COUNTY_DEVELOPMENT_PROFILE,
    )
    .is_err());
    assert!(NavigationPolicy::new_for_profile(
        "http://127.0.0.1",
        COUNTY_DEVELOPMENT_PROFILE,
    )
    .is_err());
    assert!(NavigationPolicy::new_for_profile(
        "http://127.0.0.1:3200",
        "unknown-profile",
    )
    .is_err());
}
