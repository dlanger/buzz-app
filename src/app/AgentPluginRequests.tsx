import { useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../shared/design-system/ui/Button";
import { InlineHeader } from "../shared/design-system/ui/Header";
import { PreferenceRow } from "../shared/design-system/ui/PreferenceRow";
import { SettingsGroup } from "../shared/design-system/ui/SettingsGroup";
import type { PluginManager } from "../plugins/manager";
import type { PluginRequest } from "../plugins/requests";
import type { Catalog } from "../plugins/types";
import { ManagedPluginReview } from "./ManagedPlugins";
import styles from "./Settings.module.css";

type Authorize = NonNullable<
  Parameters<typeof ManagedPluginReview>[0]["authorizeGit"]
>;

const VERB: Record<PluginRequest["action"], string> = {
  install: "Install",
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
  const review = reviewing?.source && (
    <ManagedPluginReview
      plugins={plugins}
      catalog={catalog}
      busy={busy}
      source={reviewing.requester.name}
      entry={{
        id: reviewing.pluginId,
        ...reviewing.source,
        state: "missing",
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
