import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { npubEncode } from "nostr-tools/nip19";
import type { BackupStatus } from "../features/identity/backup";
import { BACKUP_FAILURES } from "../features/identity/backup-failure";
import { BackupPrompt } from "../features/identity/BackupConsent";
import { backupOfferedFor } from "../features/identity/builderlab-account";
import type { Identity } from "../features/identity/service";
import type { FederatedIdentity } from "../features/federated-identity/service";
import { recoveryMessage } from "../features/federated-identity/CommunitySignIn";
import { PrivateKey } from "../features/identity/PrivateKey";
import { SignOutDialog } from "../features/identity/SignOut";
import { Header, InlineHeader } from "../shared/design-system/ui/Header";
import { SettingsGroup } from "../shared/design-system/ui/SettingsGroup";
import { PreferenceRow } from "../shared/design-system/ui/PreferenceRow";
import { IconButton } from "../shared/design-system/ui/IconButton";
import { Button } from "../shared/design-system/ui/Button";
import { Tooltip } from "../shared/design-system/ui/Tooltip";
import { ToastNotice } from "../shared/design-system/ui/Toast";
import { CopyIcon } from "../shared/design-system/icons";
import styles from "./IdentitySettings.module.css";
import { writeClipboardText } from "../shared/clipboard";

const WAITING = {
  no_consent: "Automatic backup is off for this key.",
  no_session: "Sign in to Builderlab to back up your key.",
  not_linked: BACKUP_FAILURES.not_linked.message,
} as const;

/** One sentence per uploader status; failures read as first run's copy. */
function backupSentence(status: BackupStatus) {
  switch (status.status) {
    case "idle":
      // Nothing has run this launch; a backup may still exist from an earlier one.
      return "Buzz hasn’t checked your key’s backup since it opened.";
    case "running":
      return "Backing up your key…";
    case "complete":
      return "Your key is backed up to Builderlab.";
    case "waiting":
      return WAITING[status.reason];
    case "failed": {
      // Settings has no Try again; a new Builderlab sign-in hands the
      // uploader a session, which starts another pass, so a kind it clears
      // (every retryable one, and a lapsed sign-in) says so.
      const failure: { cause?: string; message: string } =
        BACKUP_FAILURES[status.kind];
      return failure.cause
        ? `${failure.cause} Buzz tries again when you next sign in to Builderlab.`
        : failure.message;
    }
  }
}

/**
 * The uploader's status. While it waits for consent (signed in to Builderlab,
 * backup off or not yet chosen), Back up key opens the backup prompt, so a
 * declined prompt can be reversed. Hidden wherever first run would not offer
 * backup, by the same rule.
 */
function BackupRow({
  identity,
  viewer,
}: {
  identity: Identity;
  viewer: string;
}) {
  const { backup } = identity;
  const status = useSyncExternalStore(backup.subscribe, backup.snapshot);
  const [offered, setOffered] = useState(false);
  const [asking, setAsking] = useState(false);
  const action = useRef<HTMLButtonElement>(null);
  const sentence = useRef<HTMLSpanElement>(null);
  const backedUp = useRef(false);
  useEffect(() => {
    void backupOfferedFor(backup).then(setOffered);
  }, [backup]);
  if (!offered || !status) return null;
  const waiting = status.status === "waiting" && status.reason === "no_consent";
  return (
    <>
      <PreferenceRow
        title="Key backup"
        subtitle={
          <span ref={sentence} role="status" tabIndex={-1}>
            {backupSentence(status)}
          </span>
        }
        trailing={
          waiting ? (
            <Button ref={action} type="button" onClick={() => setAsking(true)}>
              Back up key
            </Button>
          ) : null
        }
      />
      {asking && (
        <BackupPrompt
          identity={identity}
          pubkey={viewer}
          onClose={(saved) => {
            backedUp.current = saved === true;
            setAsking(false);
          }}
          // Back up ends the consent wait, which removes the action, perhaps
          // only after the prompt has closed; the status stays in Settings.
          finalFocus={() =>
            (backedUp.current ? null : action.current) ?? sentence.current
          }
        />
      )}
    </>
  );
}

export function IdentitySettings({
  viewer,
  identity,
  federatedIdentity,
}: {
  viewer?: string | undefined;
  identity?: Identity | undefined;
  federatedIdentity?: FederatedIdentity | undefined;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [copyStatus, setCopyStatus] = useState<{
    message: string;
    failed: boolean;
  } | null>(null);
  const copyAttempt = useRef(0);
  const npub = viewer ? npubEncode(viewer) : "";
  async function copyIdentity(value: string, label: string) {
    const attempt = ++copyAttempt.current;
    setCopyStatus(null);
    try {
      await writeClipboardText(value);
      if (attempt === copyAttempt.current)
        setCopyStatus({ message: `${label} copied.`, failed: false });
    } catch {
      if (attempt === copyAttempt.current)
        setCopyStatus({
          message: `Couldn’t copy ${label.toLowerCase()}. Select it and copy manually.`,
          failed: true,
        });
    }
  }
  return (
    <section aria-labelledby="identity-settings-title">
      <Header
        id="identity-settings-title"
        title="Identity"
        subtitle="Your identity is shared across communities. Public keys are safe to share."
      />
      {!viewer && (
        <p>Your identity is unavailable. Connect your identity to manage it.</p>
      )}
      {viewer && (
        <>
          <SettingsGroup>
            {(
              [
                ["Public key (hex)", "Public key", viewer],
                ["Nostr address (npub)", "Nostr address", npub],
              ] as const
            ).map(([label, copyLabel, value]) => (
              <PreferenceRow
                key={label}
                title={label}
                subtitle={
                  <code className={`text-mono ${styles.identityValue}`}>
                    {value}
                  </code>
                }
                trailing={
                  <Tooltip
                    content={`Copy ${copyLabel.toLowerCase()}`}
                    hint="familiar"
                  >
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={`Copy ${copyLabel.toLowerCase()}`}
                      icon={<CopyIcon aria-hidden="true" />}
                      onClick={() => void copyIdentity(value, copyLabel)}
                    />
                  </Tooltip>
                }
              />
            ))}
          </SettingsGroup>
          {identity && (
            <div className="mt-6">
              <SettingsGroup layout="form">
                {/* One key widget at a time; the dialog brings its own. */}
                {!signingOut && <PrivateKey identity={identity} />}
              </SettingsGroup>
              <SettingsGroup>
                <BackupRow identity={identity} viewer={viewer} />
                <PreferenceRow
                  title="Sign out of Buzz"
                  subtitle="Remove your private key from this device. Also signs you out of your organization and ends Builderlab and hosted community logins."
                  trailing={
                    <Button type="button" onClick={() => setSigningOut(true)}>
                      Sign out of Buzz
                    </Button>
                  }
                />
              </SettingsGroup>
              {signingOut && (
                <SignOutDialog
                  identity={identity}
                  onClose={() => setSigningOut(false)}
                />
              )}
            </div>
          )}
          {federatedIdentity && (
            <OrganizationSignIn identity={federatedIdentity} />
          )}
          {copyStatus && (
            <ToastNotice
              title={
                copyStatus.failed
                  ? "Identity wasn’t copied"
                  : copyStatus.message
              }
              {...(copyStatus.failed
                ? { description: copyStatus.message }
                : {})}
              tone={copyStatus.failed ? "error" : "success"}
              timeout={copyStatus.failed ? 0 : 5000}
              onDismiss={() => setCopyStatus(null)}
            />
          )}
        </>
      )}
    </section>
  );
}

function OrganizationSignIn({ identity }: { identity: FederatedIdentity }) {
  const state = useSyncExternalStore(
    identity.subscribe,
    identity.snapshot,
    identity.snapshot,
  );
  const [failure, setFailure] = useState("");
  const problem = failure || state.failure;
  if (!state.authority || state.status === "unconfigured") return null;
  // Controls hide when unavailable, but a failed sign-out still explains itself.
  if (state.status === "unavailable")
    return problem ? (
      <p role="alert" className="mt-6 text-body-sm text-danger">
        {recoveryMessage(problem)}
      </p>
    ) : null;
  const organization = new URL(state.authority.identityOrigin).host;
  const signedIn = state.status === "signed-in";
  const signingIn = state.status === "signing-in";
  const expires =
    signedIn && state.expiresAt
      ? new Date(state.expiresAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "";
  function run(operation: () => Promise<unknown>) {
    setFailure("");
    void Promise.resolve()
      .then(operation)
      .catch((error: unknown) =>
        setFailure(
          error instanceof Error ? error.message : "Sign-in unavailable",
        ),
      );
  }
  return (
    <section className="mt-6" aria-labelledby="organization-sign-in-title">
      <InlineHeader
        id="organization-sign-in-title"
        title="Organization sign-in"
      />
      <SettingsGroup>
        <PreferenceRow
          title={
            signedIn
              ? `Signed in as ${state.email ?? "your organization account"}`
              : "Not signed in"
          }
          subtitle={
            <>
              {expires && (
                <>
                  Expires at {expires}
                  <br />
                </>
              )}
              {`Lets you and your agents into communities that require your ${organization} login. Signing out keeps your Buzz key on this device, but you and your agents can’t connect to those communities again until you sign back in.`}
            </>
          }
          trailing={
            <Button
              type="button"
              disabled={state.status === "restoring"}
              onClick={() =>
                run(() =>
                  signedIn
                    ? identity.signOut()
                    : signingIn
                      ? identity.cancelSignIn()
                      : identity.signIn(),
                )
              }
            >
              {signedIn
                ? "Sign out of organization"
                : signingIn
                  ? "Cancel sign-in"
                  : "Sign in"}
            </Button>
          }
        />
        {problem && (
          <p role="alert" className="text-body-sm text-danger">
            {recoveryMessage(problem)}
          </p>
        )}
      </SettingsGroup>
    </section>
  );
}
