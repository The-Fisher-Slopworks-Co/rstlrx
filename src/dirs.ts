import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

// Replicates the `dirs` crate base directories used by this project.
// Returns the BASE directory (e.g. `~/.config`); callers append `rstlrx`.

function home(): string | null {
  const h = homedir();
  return h ? h : null;
}

function envDir(name: string): string | null {
  const v = process.env[name];
  return v ? v : null;
}

export function configDir(): string | null {
  switch (process.platform) {
    case "linux": {
      const xdg = process.env.XDG_CONFIG_HOME;
      if (xdg && isAbsolute(xdg)) return xdg;
      const h = home();
      return h ? join(h, ".config") : null;
    }
    case "darwin": {
      const h = home();
      return h ? join(h, "Library", "Application Support") : null;
    }
    case "win32":
      return envDir("APPDATA");
    default:
      return null;
  }
}

export function dataLocalDir(): string | null {
  switch (process.platform) {
    case "linux": {
      const xdg = process.env.XDG_DATA_HOME;
      if (xdg && isAbsolute(xdg)) return xdg;
      const h = home();
      return h ? join(h, ".local", "share") : null;
    }
    case "darwin": {
      const h = home();
      return h ? join(h, "Library", "Application Support") : null;
    }
    case "win32":
      return envDir("LOCALAPPDATA");
    default:
      return null;
  }
}
