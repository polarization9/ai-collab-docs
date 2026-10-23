import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AppUpdateButton } from "../../src/web/components/AppUpdateButton";
import { I18nProvider } from "../../src/web/i18n";
import type { AppUpdateState } from "../../src/web/updateManager";

const root = createRoot(document.getElementById("root")!);
const calls = { check: 0, checkCompleted: 0, install: 0, installCompleted: 0, relaunch: 0, outside: 0 };
let generation = 0;
const fixture = {
  calls,
  state: { status: "idle" } as AppUpdateState,
  setState: (_state: AppUpdateState) => {},
  finishCheck: (_state: AppUpdateState) => {},
  finishInstall: (_state: AppUpdateState) => {},
  reset(initialState: AppUpdateState) {
    for (const key of Object.keys(calls) as (keyof typeof calls)[]) {
      calls[key] = 0;
    }
    flushSync(() => root.render(<Harness key={++generation} initialState={initialState} />));
  },
  unmount() {
    flushSync(() => root.render(null));
  }
};

Object.assign(window, { updatePopoverFixture: fixture });

function Harness({ initialState }: { initialState: AppUpdateState }) {
  const [state, setState] = useState(initialState);
  fixture.state = state;
  fixture.setState = (nextState) => flushSync(() => setState(nextState));

  return (
    <I18nProvider language="zh-CN">
      <header style={{ display: "flex", justifyContent: "flex-end", padding: 24 }}>
        <AppUpdateButton
          state={state}
          autoCheckEnabled
          onCheck={async () => {
            calls.check += 1;
            setState({ status: "checking" });
            const result = await new Promise<AppUpdateState>((resolve) => {
              fixture.finishCheck = resolve;
            });
            setState(result);
            calls.checkCompleted += 1;
          }}
          onInstall={async () => {
            calls.install += 1;
            setState({ status: "downloading", version: "0.1.11", downloaded: 0, total: 100 });
            const result = await new Promise<AppUpdateState>((resolve) => {
              fixture.finishInstall = resolve;
            });
            setState(result);
            calls.installCompleted += 1;
          }}
          onRelaunch={async () => { calls.relaunch += 1; }}
        />
      </header>
      <main style={{ padding: 24 }}>
        <button type="button" id="outside" onClick={() => { calls.outside += 1; }}>
          Outside
        </button>
        <input aria-label="Outside input" />
      </main>
    </I18nProvider>
  );
}

fixture.reset({ status: "idle" });
