use super::*;

fn config() -> Config {
    Config {
        service_url: "https://backup.example".into(),
        namespace: "buzz-test".into(),
    }
}

#[test]
fn an_opt_out_holds_under_any_service_and_an_opt_in_only_where_it_was_saved() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("choice.json");
    let config = config();
    assert_eq!(read(&path, &config, "key").unwrap().automatic, None);
    for (pubkey, service, namespace, version, automatic, expected) in [
        (
            "key",
            "https://backup.example",
            "buzz-test",
            1,
            true,
            Some(true),
        ),
        (
            "key",
            "https://backup.example",
            "buzz-test",
            1,
            false,
            Some(false),
        ),
        (
            "other",
            "https://backup.example",
            "buzz-test",
            1,
            true,
            None,
        ),
        (
            "other",
            "https://backup.example",
            "buzz-test",
            1,
            false,
            None,
        ),
        ("key", "https://other.example", "buzz-test", 1, true, None),
        ("key", "https://backup.example", "other", 1, true, None),
        ("key", "https://backup.example", "buzz-test", 2, true, None),
        (
            "key",
            "https://other.example",
            "buzz-test",
            1,
            false,
            Some(false),
        ),
        (
            "key",
            "https://backup.example",
            "other",
            1,
            false,
            Some(false),
        ),
        (
            "key",
            "https://backup.example",
            "buzz-test",
            2,
            false,
            Some(false),
        ),
        ("key", "", "", 1, false, Some(false)),
    ] {
        fs::write(
            &path,
            serde_json::to_vec(&Record {
                version,
                pubkey: pubkey.into(),
                service: service.into(),
                namespace: namespace.into(),
                automatic,
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(read(&path, &config, "key").unwrap().automatic, expected);
    }
    for bytes in [b"not json".to_vec(), vec![b' '; 4097]] {
        fs::write(&path, bytes).unwrap();
        assert!(read(&path, &config, "key").is_err());
    }
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert!(read(&path, &config, "key").is_err());
}

#[tokio::test]
async fn choices_persist_and_an_explicit_choice_repairs_corrupt_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("choice.json");
    let identity = IdentityHost::fixture();
    let pubkey = identity.viewer().await.unwrap();
    let config = config();
    fs::write(&path, b"corrupt").unwrap();
    for automatic in [true, false] {
        let saved = set(&identity, &path, &config, &pubkey, automatic, false)
            .await
            .unwrap();
        assert_eq!(saved.automatic, Some(automatic));
        let restored = read(&path, &config, &pubkey).unwrap();
        assert_eq!(restored.automatic, Some(automatic));
        assert_eq!(restored.pubkey, pubkey);
        assert!(restored.available);
    }
}

#[tokio::test]
async fn an_import_opt_out_saved_with_or_without_a_service_holds_until_backup_is_enabled() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("choice.json");
    let identity = IdentityHost::fixture();
    let pubkey = identity.viewer().await.unwrap();
    let config = config();
    let other = Config {
        service_url: "https://other.example".into(),
        namespace: "other".into(),
    };
    for saved in [Some(&config), None] {
        opt_out(&path, saved, &pubkey).unwrap();
        for current in [&config, &other] {
            assert_eq!(
                read(&path, current, &pubkey).unwrap().automatic,
                Some(false)
            );
            assert_eq!(read(&path, current, "other").unwrap().automatic, None);
        }
    }
    set(&identity, &path, &config, &pubkey, true, false)
        .await
        .unwrap();
    assert_eq!(read(&path, &config, &pubkey).unwrap().automatic, Some(true));
    assert_eq!(read(&path, &other, &pubkey).unwrap().automatic, None);
    // Another copy holding the lease refuses the opt-out rather than skipping it.
    let held = read(&path, &config, &pubkey).unwrap();
    assert_eq!(opt_out(&path, None, &pubkey).err().as_deref(), Some(BUSY));
    drop(held);
}

#[tokio::test]
async fn stale_key_selection_cannot_save_permission_for_the_current_identity() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("choice.json");
    let identity = IdentityHost::fixture();
    assert!(
        set(&identity, &path, &config(), &"ab".repeat(32), true, false)
            .await
            .is_err()
    );
    assert!(!path.exists());
}

#[tokio::test]
async fn choice_changes_serialize_with_admitted_readers_across_copies() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("choice.json");
    let identity = IdentityHost::fixture();
    let pubkey = identity.viewer().await.unwrap();
    let config = config();
    set(&identity, &path, &config, &pubkey, true, false)
        .await
        .unwrap();
    let first = read(&path, &config, &pubkey).unwrap();
    let second = read(&path, &config, &pubkey).unwrap();
    assert!(set(&identity, &path, &config, &pubkey, false, false)
        .await
        .is_err());
    drop(first);
    assert!(set(&identity, &path, &config, &pubkey, false, false)
        .await
        .is_err());
    drop(second);
    set(&identity, &path, &config, &pubkey, false, false)
        .await
        .unwrap();
    assert_eq!(
        read(&path, &config, &pubkey).unwrap().automatic,
        Some(false)
    );
}

#[test]
fn a_released_lease_is_free_even_while_a_spawned_child_still_shares_it() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("choice.json");
    let held = lock(&path, true).unwrap();
    let child = held.inherited();
    // Another copy still holding its lease is busy at once.
    assert_eq!(lock(&path, false).err().as_deref(), Some(BUSY));
    drop(held);
    assert!(lock(&path, false).is_ok());
    drop(child);
}

#[tokio::test]
async fn failed_storage_does_not_report_saved_consent() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("choice.json");
    fs::create_dir(&path).unwrap();
    let identity = IdentityHost::fixture();
    let pubkey = identity.viewer().await.unwrap();
    assert!(set(&identity, &path, &config(), &pubkey, true, false)
        .await
        .is_err());
    assert!(read(&path, &config(), &pubkey).is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn directory_sync_failure_does_not_report_a_durable_revocation() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("choice.json");
    let identity = IdentityHost::fixture();
    let pubkey = identity.viewer().await.unwrap();
    let config = config();
    set(&identity, &path, &config, &pubkey, true, false)
        .await
        .unwrap();
    // Rename remains permitted, but opening the directory for its durability sync fails.
    fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o300)).unwrap();
    let result = set(&identity, &path, &config, &pubkey, false, false).await;
    fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o700)).unwrap();

    assert_eq!(result.err().as_deref(), Some(FAILED));
    assert_eq!(
        read(&path, &config, &pubkey).unwrap().automatic,
        Some(false)
    );
    set(&identity, &path, &config, &pubkey, false, false)
        .await
        .unwrap();
}
