type StartupOptions = {
  initialize: () => Promise<unknown>;
  onReady: () => void;
  onError: (error: unknown) => void;
  scheduleRetry?: (retry: () => void) => void;
};

/** HTTP liveness is independent of inventory/database readiness. */
export function createInventoryStartup() {
  let ready = false;
  let started = false;

  return {
    isReady: () => ready,
    start({
      initialize,
      onReady,
      onError,
      scheduleRetry = (retry) => { setTimeout(retry, 15_000).unref(); },
    }: StartupOptions) {
      if (started) return;
      started = true;

      const attempt = async () => {
        try {
          await initialize();
          onReady();
          ready = true;
        } catch (error) {
          ready = false;
          onError(error);
          scheduleRetry(() => { void attempt(); });
        }
      };
      void attempt();
    },
  };
}

export const inventoryStartup = createInventoryStartup();