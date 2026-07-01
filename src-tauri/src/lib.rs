use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::Emitter;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessResult {
    #[serde(alias = "outputPath")]
    output_path: String,
    width: u32,
    height: u32,
    #[serde(alias = "topStrip")]
    top_strip: u32,
    radius: u32,
    #[serde(alias = "autoCalculated")]
    auto_calculated: bool,
    #[serde(alias = "frameCount")]
    frame_count: u32,
    animated: bool,
    warning: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewResult {
    data_url: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    current: u32,
    total: u32,
    stage: String,
    percent: u32,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ProcessorMessage {
    Progress {
        current: u32,
        total: u32,
        stage: String,
        percent: u32,
    },
    Result {
        #[serde(alias = "outputPath")]
        output_path: String,
        width: u32,
        height: u32,
        #[serde(alias = "topStrip")]
        top_strip: u32,
        radius: u32,
        #[serde(alias = "autoCalculated")]
        auto_calculated: bool,
        #[serde(alias = "frameCount")]
        frame_count: u32,
        animated: bool,
        warning: Option<String>,
    },
}

fn project_root() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|err| err.to_string())?;

    if cwd.ends_with("src-tauri") {
        cwd.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "Could not resolve project root.".to_string())
    } else {
        Ok(cwd)
    }
}

fn node_command() -> Command {
    Command::new("node")
}

fn process_image_sync(
    window: tauri::Window,
    input_path: String,
    output_name: Option<String>,
    top_strip: Option<u32>,
    radius: Option<u32>,
    fast_animated: bool,
) -> Result<ProcessResult, String> {
    let root = project_root()?;
    let script_path = root.join("scripts").join("process-image.mjs");

    let mut command = node_command();
    command.arg(script_path);
    command.arg(input_path);
    command.arg(output_name.unwrap_or_default());
    command.arg(top_strip.map(|value| value.to_string()).unwrap_or_default());
    command.arg(radius.map(|value| value.to_string()).unwrap_or_default());
    command.arg(if fast_animated { "true" } else { "false" });
    command.current_dir(&root);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|err| {
        format!(
            "Failed to start Node.js processor. Make sure Node.js is installed and on PATH. {}",
            err
        )
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not capture processor output.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not capture processor errors.".to_string())?;

    let stdout_reader = BufReader::new(stdout);
    let stderr_handle = std::thread::spawn(move || -> Result<String, String> {
        let mut stderr_text = String::new();
        let mut reader = BufReader::new(stderr);
        loop {
            let mut line = String::new();
            let bytes = reader.read_line(&mut line).map_err(|err| err.to_string())?;
            if bytes == 0 {
                break;
            }
            stderr_text.push_str(&line);
        }
        Ok(stderr_text)
    });

    let mut result: Option<ProcessResult> = None;

    for line_result in stdout_reader.lines() {
        let line = line_result.map_err(|err| err.to_string())?;
        if line.trim().is_empty() {
            continue;
        }

        let message: ProcessorMessage = serde_json::from_str(&line).map_err(|err| err.to_string())?;
        match message {
            ProcessorMessage::Progress {
                current,
                total,
                stage,
                percent,
            } => {
                let payload = ProgressEvent {
                    current,
                    total,
                    stage,
                    percent,
                };
                let _ = window.emit("process-progress", &payload);
            }
            ProcessorMessage::Result {
                output_path,
                width,
                height,
                top_strip,
                radius,
                auto_calculated,
                frame_count,
                animated,
                warning,
            } => {
                result = Some(ProcessResult {
                    output_path,
                    width,
                    height,
                    top_strip,
                    radius,
                    auto_calculated,
                    frame_count,
                    animated,
                    warning,
                });
            }
        }
    }

    let status = child.wait().map_err(|err| err.to_string())?;
    let stderr_text = stderr_handle
        .join()
        .map_err(|_| "Failed to read processor errors.".to_string())??;

    if !status.success() {
        let stderr = stderr_text.trim().to_string();
        let message = if !stderr.is_empty() {
            stderr
        } else {
            "Image processing failed.".to_string()
        };

        return Err(message);
    }

    result.ok_or_else(|| "Image processing did not return a result.".to_string())
}

fn save_processed_file_sync(source_path: String, target_path: String) -> Result<(), String> {
    let source = PathBuf::from(source_path);
    let target = PathBuf::from(target_path);

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    fs::copy(source, target).map_err(|err| err.to_string())?;
    Ok(())
}

fn guess_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

fn read_preview_image_sync(image_path: String) -> Result<PreviewResult, String> {
    let path = PathBuf::from(image_path);
    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    let mime = guess_mime(&path);
    let encoded = BASE64_STANDARD.encode(bytes);

    Ok(PreviewResult {
        data_url: format!("data:{mime};base64,{encoded}"),
    })
}

#[tauri::command]
async fn process_image(
    window: tauri::Window,
    input_path: String,
    output_name: Option<String>,
    top_strip: Option<u32>,
    radius: Option<u32>,
    fast_animated: Option<bool>,
) -> Result<ProcessResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        process_image_sync(
            window,
            input_path,
            output_name,
            top_strip,
            radius,
            fast_animated.unwrap_or(true),
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn save_processed_file(source_path: String, target_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_processed_file_sync(source_path, target_path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn read_preview_image(image_path: String) -> Result<PreviewResult, String> {
    tauri::async_runtime::spawn_blocking(move || read_preview_image_sync(image_path))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|err| err.to_string())
}

#[tauri::command]
fn toggle_maximize_window(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().map_err(|err| err.to_string())? {
        window.unmaximize().map_err(|err| err.to_string())
    } else {
        window.maximize().map_err(|err| err.to_string())
    }
}

#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            process_image,
            save_processed_file,
            read_preview_image,
            minimize_window,
            toggle_maximize_window,
            close_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
