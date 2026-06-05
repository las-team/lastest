import * as vscode from "vscode";

let channel: vscode.OutputChannel | null = null;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Lastest");
  }
  return channel;
}

export function disposeOutputChannel(): void {
  channel?.dispose();
  channel = null;
}
