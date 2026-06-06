use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    sync::Mutex,
    time::Duration,
};

use serde::Deserialize;
use tauri::{
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Listener, LogicalPosition, Manager, RunEvent, TitleBarStyle, Url,
    WebviewUrl,
    WebviewWindowBuilder,
};
use tauri_plugin_shell::{process::CommandEvent, process::CommandChild, ShellExt};
use uuid::Uuid;

struct OpenedFiles(Mutex<Vec<String>>);

struct DesktopState {
    token: String,
    server_url: Mutex<Option<String>>,
    server_child: Mutex<Option<CommandChild>>,
}

impl DesktopState {
    fn new() -> Self {
        Self {
            token: Uuid::new_v4().to_string(),
            server_url: Mutex::new(None),
            server_child: Mutex::new(None),
        }
    }
}

#[derive(Deserialize)]
struct ServerReadyMessage {
    #[serde(rename = "type")]
    kind: String,
    url: String,
}

#[derive(Deserialize)]
struct StoredAppSettings {
    language: Option<String>,
}

#[tauri::command]
fn opened_files(app: AppHandle) -> Vec<String> {
    let state = app.state::<OpenedFiles>();
    let mut files = state.0.lock().expect("opened files lock poisoned");
    let opened = files.clone();
    files.clear();
    opened
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths = args
                .iter()
                .filter_map(|arg| normalize_opened_file_arg(arg))
                .collect::<Vec<_>>();

            if !paths.is_empty() {
                push_opened_files(app, paths);
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .manage(OpenedFiles(Mutex::new(Vec::new())))
        .manage(DesktopState::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .menu(build_app_menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "margent-open-file" => {
                let _ = app.emit("margent-menu-command", "open-file");
            }
            "margent-open-settings" => {
                let _ = show_settings_window(app);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![opened_files, open_settings_window])
        .setup(|app| {
            let app_handle = app.handle().clone();
            register_native_settings_listener(&app_handle);
            let startup_paths = std::env::args()
                .filter_map(|arg| normalize_opened_file_arg(&arg))
                .collect::<Vec<_>>();
            let startup_document = startup_paths.first().cloned();
            if !startup_paths.is_empty() {
                push_opened_files(&app_handle, startup_paths);
            }
            start_reviewer_server(app_handle, startup_document)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Tauri application")
        .run(|app, event| match event {
            RunEvent::Opened { urls } => {
                let paths = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|path| path.to_string_lossy().to_string())
                    .collect::<Vec<_>>();
                if !paths.is_empty() {
                    push_opened_files(app, paths);
                }
            }
            RunEvent::ExitRequested { .. } => {
                let state = app.state::<DesktopState>();
                let child = {
                    let mut guard = state
                        .server_child
                        .lock()
                        .expect("server child lock poisoned");
                    guard.take()
                };
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
            _ => {}
        });
}

fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let labels = native_labels();
    let settings = MenuItemBuilder::with_id("margent-open-settings", labels.settings)
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let quit = PredefinedMenuItem::quit(app, Some(labels.quit))?;
    let app_menu = Submenu::with_items(
        app,
        "Margent",
        true,
        &[
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let open_file = MenuItemBuilder::with_id("margent-open-file", labels.open_file)
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let file_menu = Submenu::with_items(
        app,
        labels.file,
        true,
        &[
            &open_file,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some(labels.close_window))?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        labels.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(labels.undo))?,
            &PredefinedMenuItem::redo(app, Some(labels.redo))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(labels.cut))?,
            &PredefinedMenuItem::copy(app, Some(labels.copy))?,
            &PredefinedMenuItem::paste(app, Some(labels.paste))?,
            &PredefinedMenuItem::select_all(app, Some(labels.select_all))?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        labels.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(labels.minimize))?,
            &PredefinedMenuItem::maximize(app, Some(labels.zoom))?,
            &PredefinedMenuItem::fullscreen(app, Some(labels.fullscreen))?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &window_menu])
}

struct MenuLabels {
    settings: &'static str,
    settings_window_title: &'static str,
    quit: &'static str,
    open_file: &'static str,
    file: &'static str,
    edit: &'static str,
    window: &'static str,
    close_window: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    minimize: &'static str,
    zoom: &'static str,
    fullscreen: &'static str,
}

fn native_labels() -> MenuLabels {
    if resolve_native_locale() == NativeLocale::Zh {
        return MenuLabels {
            settings: "设置...",
            settings_window_title: "Margent 设置",
            quit: "退出 Margent",
            open_file: "打开 Markdown 文件...",
            file: "文件",
            edit: "编辑",
            window: "窗口",
            close_window: "关闭窗口",
            undo: "撤销",
            redo: "重做",
            cut: "剪切",
            copy: "复制",
            paste: "粘贴",
            select_all: "全选",
            minimize: "最小化",
            zoom: "缩放",
            fullscreen: "进入全屏幕",
        };
    }

    MenuLabels {
        settings: "Settings...",
        settings_window_title: "Margent Settings",
        quit: "Quit Margent",
        open_file: "Open Markdown File...",
        file: "File",
        edit: "Edit",
        window: "Window",
        close_window: "Close Window",
        undo: "Undo",
        redo: "Redo",
        cut: "Cut",
        copy: "Copy",
        paste: "Paste",
        select_all: "Select All",
        minimize: "Minimize",
        zoom: "Zoom",
        fullscreen: "Enter Full Screen",
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum NativeLocale {
    Zh,
    En,
}

fn resolve_native_locale() -> NativeLocale {
    match read_configured_language().as_deref() {
        Some("zh-CN") => NativeLocale::Zh,
        Some("en-US") => NativeLocale::En,
        _ => {
            if is_system_chinese() {
                NativeLocale::Zh
            } else {
                NativeLocale::En
            }
        }
    }
}

fn read_configured_language() -> Option<String> {
    let settings_path = get_app_data_dir().join("settings.json");
    let raw = fs::read_to_string(settings_path).ok()?;
    let settings = serde_json::from_str::<StoredAppSettings>(&raw).ok()?;
    settings.language
}

fn get_app_data_dir() -> PathBuf {
    std::env::var_os("MARGENT_APP_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".margent")))
        .unwrap_or_else(|| PathBuf::from(".margent"))
}

fn is_system_chinese() -> bool {
    if std::env::var("LANG")
        .map(|value| value.to_ascii_lowercase().starts_with("zh"))
        .unwrap_or(false)
    {
        return true;
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("defaults")
            .args(["read", "-g", "AppleLanguages"])
            .output()
        {
            let languages = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
            if languages.contains("zh") {
                return true;
            }
        }
    }

    false
}

fn register_native_settings_listener(app: &AppHandle) {
    let app_handle = app.clone();
    app.listen("margent-settings-updated", move |_| {
        if let Err(error) = refresh_native_language(&app_handle) {
            eprintln!("failed to refresh native Margent language: {error}");
        }
    });
}

fn refresh_native_language(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_app_menu(app)?;
    app.set_menu(menu)?;
    if let Some(window) = app.get_webview_window("settings") {
        window.set_title(native_labels().settings_window_title)?;
    }
    Ok(())
}

#[tauri::command]
fn open_settings_window(app: AppHandle) -> Result<(), String> {
    show_settings_window(&app).map_err(|error| error.to_string())
}

fn start_reviewer_server(app: AppHandle, startup_document: Option<String>) -> tauri::Result<()> {
    let token = app.state::<DesktopState>().token.clone();
    let port = reserve_local_port().map_err(|error| tauri::Error::Anyhow(anyhow::anyhow!(error)))?;
    let server_url = format!("http://127.0.0.1:{port}");
    let mut args = vec![
        "--desktop-server".to_string(),
        "--port".to_string(),
        port.to_string(),
        "--no-open".to_string(),
        "--desktop-token".to_string(),
        token.clone(),
    ];
    if let Some(document) = startup_document {
        args.push("--document".to_string());
        args.push(document);
    }

    let sidecar = app
        .shell()
        .sidecar("margent-server")
        .map_err(|error| tauri::Error::Anyhow(anyhow::anyhow!(error)))?
        .args(args);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|error| tauri::Error::Anyhow(anyhow::anyhow!(error)))?;
    app.state::<DesktopState>()
        .server_child
        .lock()
        .expect("server child lock poisoned")
        .replace(child);
    wait_for_reviewer_server(app.clone(), server_url, port);

    tauri::async_runtime::spawn(async move {
        let mut stdout_buffer = String::new();

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    stdout_buffer.push_str(&String::from_utf8_lossy(&bytes));
                    process_stdout_buffer(&app, &mut stdout_buffer);
                }
                CommandEvent::Stderr(bytes) => {
                    eprint!("{}", String::from_utf8_lossy(&bytes));
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn reserve_local_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

fn wait_for_reviewer_server(app: AppHandle, server_url: String, port: u16) {
    std::thread::spawn(move || {
        let address: SocketAddr = match format!("127.0.0.1:{port}").parse() {
            Ok(address) => address,
            Err(error) => {
                eprintln!("failed to parse reviewer server address: {error}");
                return;
            }
        };

        for _ in 0..120 {
            if TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() {
                if let Err(error) = open_main_window(&app, &server_url) {
                    eprintln!("failed to open main window: {error}");
                }
                return;
            }
            std::thread::sleep(Duration::from_millis(75));
        }

        eprintln!("timed out waiting for reviewer server at {server_url}");
    });
}

fn process_stdout_buffer(app: &AppHandle, buffer: &mut String) {
    while let Some(index) = buffer.find('\n') {
        let line = buffer[..index].trim().to_string();
        *buffer = buffer[index + 1..].to_string();

        if line.is_empty() {
            continue;
        }

        if let Ok(message) = serde_json::from_str::<ServerReadyMessage>(&line) {
            if message.kind == "server-ready" {
                if let Err(error) = open_main_window(app, &message.url) {
                    eprintln!("failed to open main window: {error}");
                }
            }
        } else {
            println!("{line}");
        }
    }
}

fn open_main_window(app: &AppHandle, server_url: &str) -> tauri::Result<()> {
    let state = app.state::<DesktopState>();
    *state
        .server_url
        .lock()
        .expect("server url lock poisoned") = Some(server_url.to_string());

    let pending_paths = app
        .state::<OpenedFiles>()
        .0
        .lock()
        .expect("opened files lock poisoned")
        .clone();
    sync_opened_files_to_server(app, pending_paths, false);

    let url = format!("{}/?desktopToken={}", server_url, state.token);
    if let Some(window) = app.get_webview_window("main") {
        window.eval(&format!("window.location.href = {}", json_string(&url)))?;
        window.set_focus()?;
        return Ok(());
    }

    let mut window_builder = WebviewWindowBuilder::new(
        app,
        "main",
        WebviewUrl::External(Url::parse(&url).expect("invalid reviewer server URL")),
    )
    .title("Margent")
    .inner_size(1280.0, 860.0)
    .min_inner_size(960.0, 640.0);

    #[cfg(target_os = "macos")]
    {
        window_builder = window_builder
            .title_bar_style(TitleBarStyle::Overlay)
            .traffic_light_position(LogicalPosition::new(16.0, 28.0))
            .hidden_title(true);
    }

    window_builder.build()?;

    Ok(())
}

fn show_settings_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("settings") {
        window.set_focus()?;
        return Ok(());
    }

    let state = app.state::<DesktopState>();
    let server_url = state
        .server_url
        .lock()
        .expect("server url lock poisoned")
        .clone()
        .ok_or_else(|| tauri::Error::Anyhow(anyhow::anyhow!("Margent server is not ready.")))?;
    let url = format!("{}/?settingsWindow=1&desktopToken={}", server_url, state.token);
    let title = native_labels().settings_window_title;

    WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::External(Url::parse(&url).expect("invalid settings URL")),
    )
    .title(title)
    .inner_size(520.0, 300.0)
    .min_inner_size(480.0, 280.0)
    .resizable(false)
    .center()
    .build()?;

    Ok(())
}

fn push_opened_files(app: &AppHandle, paths: Vec<String>) {
    app.state::<OpenedFiles>()
        .0
        .lock()
        .expect("opened files lock poisoned")
        .extend(paths.clone());
    sync_opened_files_to_server(app, paths.clone(), false);
    let _ = app.emit("desktop-open-files", paths);
}

fn sync_opened_files_to_server(app: &AppHandle, paths: Vec<String>, reload_after_sync: bool) {
    let Some(path) = paths.first().cloned() else {
        return;
    };

    let state = app.state::<DesktopState>();
    let server_url = state
        .server_url
        .lock()
        .expect("server url lock poisoned")
        .clone();
    let token = state.token.clone();
    let Some(server_url) = server_url else {
        return;
    };
    let app_handle = app.clone();

    std::thread::spawn(move || {
        if let Err(error) = post_open_document(&server_url, &token, &path) {
            eprintln!("failed to sync opened document: {error}");
            return;
        }

        if reload_after_sync {
            reload_main_window(&app_handle);
        }
    });
}

fn reload_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("window.location.reload()");
        let _ = window.set_focus();
    }
}

fn post_open_document(server_url: &str, token: &str, path: &str) -> std::io::Result<()> {
    let url = Url::parse(server_url).map_err(std::io::Error::other)?;
    let host = url
        .host_str()
        .ok_or_else(|| std::io::Error::other("reviewer server URL has no host"))?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| std::io::Error::other("reviewer server URL has no port"))?;
    let endpoint = format!("{}/api/session/document", url.path().trim_end_matches('/'));
    let body = serde_json::json!({ "path": path }).to_string();
    let request = format!(
        "POST {endpoint} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nX-Margent-Token: {token}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    let mut stream = TcpStream::connect((host, port))?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    stream.write_all(request.as_bytes())?;

    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    if !response.starts_with("HTTP/1.1 2") && !response.starts_with("HTTP/1.0 2") {
        return Err(std::io::Error::other(
            response.lines().next().unwrap_or("document open request failed"),
        ));
    }

    Ok(())
}

fn normalize_opened_file_arg(arg: &str) -> Option<String> {
    if arg.starts_with("file://") {
        return Url::parse(arg)
            .ok()
            .and_then(|url| url.to_file_path().ok())
            .map(|path| path.to_string_lossy().to_string());
    }

    if arg.ends_with(".md") || arg.ends_with(".markdown") {
        return Some(arg.to_string());
    }

    None
}

fn json_string(value: &str) -> String {
    serde_json::to_string(value).expect("failed to JSON encode string")
}
