type OpenFilesListener = (paths: string[]) => void;

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

export async function pickMarkdownFile(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: "Markdown",
        extensions: ["md", "markdown"]
      }
    ]
  });

  return typeof selected === "string" ? selected : null;
}

export async function getInitialOpenedFiles(): Promise<string[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string[]>("opened_files");
  } catch (error) {
    console.warn("Unable to read initially opened files from Tauri.", error);
    return [];
  }
}

export async function listenForOpenedFiles(listener: OpenFilesListener): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }

  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<string[]>("desktop-open-files", (event) => {
      listener(event.payload);
    });
    return unlisten;
  } catch (error) {
    console.warn("Unable to listen for opened files from Tauri.", error);
    return () => undefined;
  }
}
