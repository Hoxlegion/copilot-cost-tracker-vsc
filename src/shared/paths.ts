import * as path from "node:path";
import * as os from "node:os";

/**
 * Returns the platform-specific VS Code user data directory.
 * e.g. `%APPDATA%/Code/User` on Windows, `~/Library/Application Support/Code/User` on macOS.
 */
export function getVscodeUserDataPath(): string {
  const homeDir = os.homedir();
  const platform = os.platform();

  if (platform === "win32") {
    return path.join(homeDir, "AppData", "Roaming", "Code", "User");
  } else if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "Code", "User");
  } else {
    return path.join(homeDir, ".config", "Code", "User");
  }
}
