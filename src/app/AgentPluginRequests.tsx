import { useRef, useState, useSyncExternalStore } from "react";
import { AlertDialog } from "../shared/design-system/ui/AlertDialog";
import { Button } from "../shared/design-system/ui/Button";
import { Dialog } from "../shared/design-system/ui/Dialog";
import { InlineHeader } from "../shared/design-system/ui/Header";
import { PreferenceRow } from "../shared/design-system/ui/PreferenceRow";
import { SettingsGroup } from "../shared/design-system/ui/SettingsGroup";
import type { PluginManager } from "../plugins/manager";
import type { PluginRequest } from "../plugins/requests";
import type { Catalog } from "../plugins/types";
import { ManagedPluginReview } from "./ManagedPlugins";
import { PluginAccessReview } from "./PluginAccessReview";
import styles from "./Settings.module.css";

type Authorize = NonNullable<
  Parameters<typeof ManagedPluginReview>[0]["authorizeGit"]
>;

const VERB: Record<PluginRequest["action"], string> = {
  install: "Install",
  update: "Update",
  enable: "Enable",
  remove: "Delete",
};

/** Plugin changes agents asked for. Each applies only through the same
 * review a person's own install uses. */
export function AgentPluginRequests({
  plugins,
  catalog,
  busy,
  authorizeGit,
}: {
  plugins: PluginManager;
  catalog: Catalog;
  busy: boolean;
  authorizeGit?: Authorize | undefined;
}) {
  const { requests } = plugins;
  const pending = useSyncExternalStore(requests.subscribe, requests.pending);
  // Held, not looked up, so settling the request never remounts the review.
  const [reviewing, setReviewing] = useState<PluginRequest>();
  const trigger = useRef<HTMLElement | null>(null);
  const close = () => setReviewing(undefined);
  const review = !reviewing ? null : !reviewing.source ? (
    <ChangeReview
      plugins={plugins}
      catalog={catalog}
      request={reviewing}
      returnFocus={() => trigger.current}
      onClose={close}
    />
  ) : (
    <ManagedPluginReview
      plugins={plugins}
      catalog={catalog}
      busy={busy}
      source={reviewing.requester.name}
      entry={{
        id: reviewing.pluginId,
        ...reviewing.source,
        state: reviewing.action === "install" ? "missing" : "outdated",
      }}
      authorizeGit={authorizeGit}
      requestedBy={{
        name: reviewing.requester.name,
        reason: reviewing.reason,
      }}
      returnFocus={() => trigger.current}
      onInstalled={() => requests.settle(reviewing.id, "approved")}
      onClose={close}
    />
  );
  return (
    <>
      {pending.length > 0 && (
        <section
          aria-labelledby="agent-plugin-requests-title"
          className={styles.pluginCoreSection}
        >
          <InlineHeader
            id="agent-plugin-requests-title"
            title="Requested by agents"
          />
          <SettingsGroup>
            {pending.map((request) => (
              <PreferenceRow
                key={request.id}
                title={`${VERB[request.action]} ${request.pluginName}`}
                subtitle={`${request.requester.name}: ${request.reason}`}
                trailing={
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="subtle"
                      aria-label={`Decline ${request.pluginName}`}
                      onClick={() => requests.settle(request.id, "declined")}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      variant="prominent"
                      disabled={busy}
                      aria-label={`Review ${request.pluginName}`}
                      onClick={(event) => {
                        trigger.current = event.currentTarget;
                        setReviewing(request);
                      }}
                    >
                      Review
                    </Button>
                  </div>
                }
              />
            ))}
          </SettingsGroup>
        </section>
      )}
      {review}
    </>
  );
}

/** Enable and remove change no code, so they confirm here rather than
 * through an import review. */
function ChangeReview({
  plugins,
  catalog,
  request,
  returnFocus,
  onClose,
}: {
  plugins: PluginManager;
  catalog: Catalog;
  request: PluginRequest;
  returnFocus: () => HTMLElement | null;
  onClose: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const plugin = catalog.plugins.find(
    (item) => item.manifest.id === request.pluginId,
  );
  const name = plugin?.manifest.name ?? request.pluginName;
  const { action } = request;
  async function confirm() {
    if (working || (action !== "enable" && action !== "remove")) return;
    setWorking(true);
    setFailure(null);
    try {
      if (await plugins.change(action, request.pluginId)) {
        plugins.requests.settle(request.id, "approved");
        onClose();
      } else
        setFailure(
          plugins.snapshot().error ?? "The change wasn’t confirmed. Try again.",
        );
    } finally {
      setWorking(false);
    }
  }
  const body = (
    <>
      <p className="mb-4 mt-0 break-words text-body-sm">{request.reason}</p>
      {!plugin && (
        <p className="m-0 text-body-sm">This plugin is no longer installed.</p>
      )}
      {failure && (
        <p role="alert" className="error text-body-sm">
          {failure}
        </p>
      )}
    </>
  );
  if (action === "remove")
    return (
      <AlertDialog
        title={`Delete ${name}?`}
        description={`Requested by ${request.requester.name}. Removes this plugin and its rollback history from Buzz. You can install it again later.`}
        pending={working}
        finalFocus={returnFocus}
        onClose={onClose}
        actions={
          <>
            <Button disabled={working} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={working || !plugin}
              onClick={() => void confirm()}
            >
              Delete plugin
            </Button>
          </>
        }
      >
        {body}
      </AlertDialog>
    );
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Enable ${name}?`}
      description={`Requested by ${request.requester.name}. Only enable code you trust.`}
      preventClose={working}
      dismissOnOutsideClick
      finalFocus={returnFocus}
      actions={
        <>
          <Button disabled={working} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="prominent"
            disabled={working || !plugin}
            loading={working}
            onClick={() => void confirm()}
          >
            Enable plugin
          </Button>
        </>
      }
    >
      {body}
      {plugin && <PluginAccessReview manifest={plugin.manifest} />}
    </Dialog>
  );
}
