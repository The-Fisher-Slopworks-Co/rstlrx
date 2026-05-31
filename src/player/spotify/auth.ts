import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataLocalDir } from "../../dirs";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

const SUCCESS_HTML =
  "<html><body><h1>Login successful!</h1><p>You can close this tab.</p></body></html>";

export class SpotifyAuth {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;

  constructor(
    client_id: string,
    client_secret: string,
    access_token: string,
    refresh_token: string,
    expires_at: number,
  ) {
    this.client_id = client_id;
    this.client_secret = client_secret;
    this.access_token = access_token;
    this.refresh_token = refresh_token;
    this.expires_at = expires_at;
  }

  static storagePath(): string {
    const base = dataLocalDir();
    if (base === null) {
      throw new Error("cannot determine data directory");
    }
    return join(base, "rstlrx", "spotify-auth.json");
  }

  static async load(): Promise<SpotifyAuth> {
    const path = SpotifyAuth.storagePath();
    let data: string;
    try {
      data = await Bun.file(path).text();
    } catch (err) {
      throw new Error(`cannot read ${path}. Run \`rstlrx login\` first.`, {
        cause: err,
      });
    }
    const parsed = JSON.parse(data) as {
      client_id: string;
      client_secret: string;
      access_token: string;
      refresh_token: string;
      expires_at: number;
    };
    return new SpotifyAuth(
      parsed.client_id,
      parsed.client_secret,
      parsed.access_token,
      parsed.refresh_token,
      parsed.expires_at,
    );
  }

  async save(): Promise<void> {
    const path = SpotifyAuth.storagePath();
    await mkdir(dirname(path), { recursive: true });
    const data = JSON.stringify(this, null, 2);
    await Bun.write(path, data);
  }

  static authUrl(clientId: string, port: number): string {
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const url = new URL("https://accounts.spotify.com/authorize");
    url.searchParams.append("client_id", clientId);
    url.searchParams.append("response_type", "code");
    url.searchParams.append("redirect_uri", redirectUri);
    url.searchParams.append(
      "scope",
      "user-read-currently-playing user-read-playback-state",
    );
    return url.toString();
  }

  static async exchangeCode(
    clientId: string,
    clientSecret: string,
    code: string,
    port: number,
  ): Promise<SpotifyAuth> {
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const body = new URLSearchParams();
    body.append("grant_type", "authorization_code");
    body.append("code", code);
    body.append("redirect_uri", redirectUri);

    const resp = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body,
    });

    if (!resp.ok) {
      throw new Error(`spotify token exchange: ${await resp.text()}`);
    }

    const token = (await resp.json()) as TokenResponse;

    if (token.refresh_token === undefined) {
      throw new Error("no refresh_token in response");
    }

    return new SpotifyAuth(
      clientId,
      clientSecret,
      token.access_token,
      token.refresh_token,
      nowSecs() + token.expires_in,
    );
  }

  async getToken(): Promise<string> {
    if (nowSecs() + 5 >= this.expires_at) {
      await this.refresh();
    }
    return this.access_token;
  }

  async refresh(): Promise<void> {
    const body = new URLSearchParams();
    body.append("grant_type", "refresh_token");
    body.append("refresh_token", this.refresh_token);

    const resp = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${this.client_id}:${this.client_secret}`)}`,
      },
      body,
    });

    if (!resp.ok) {
      throw new Error(`spotify refresh: ${await resp.text()}`);
    }

    const token = (await resp.json()) as TokenResponse;
    this.access_token = token.access_token;
    if (token.refresh_token !== undefined) {
      this.refresh_token = token.refresh_token;
    }
    this.expires_at = nowSecs() + token.expires_in;
    await this.save();
  }

  static async loginFlow(
    clientId: string,
    clientSecret: string,
    port: number,
  ): Promise<SpotifyAuth> {
    const url = SpotifyAuth.authUrl(clientId, port);
    console.log("Opening browser for Spotify login...");
    try {
      openBrowser(url);
    } catch (err) {
      throw new Error("failed to open browser", { cause: err });
    }

    const code = await SpotifyAuth.waitForCallback(port);
    const auth = await SpotifyAuth.exchangeCode(
      clientId,
      clientSecret,
      code,
      port,
    );
    await auth.save();
    console.log("Login successful! Auth saved.");
    return auth;
  }

  static async waitForCallback(port: number): Promise<string> {
    return await new Promise<string>((resolve) => {
      let done = false;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port,
        fetch(req): Response {
          const code = new URL(req.url).searchParams.get("code");
          const response = new Response(SUCCESS_HTML, {
            headers: { "Content-Type": "text/html" },
          });
          if (code !== null && !done) {
            done = true;
            resolve(code);
            server.stop();
          }
          return response;
        },
      });
      console.log(`Waiting for callback on port ${port}...`);
    });
  }
}

function openBrowser(url: string): void {
  let cmd: string[];
  switch (process.platform) {
    case "darwin":
      cmd = ["open", url];
      break;
    case "win32":
      cmd = ["cmd", "/c", "start", "", url];
      break;
    default:
      cmd = ["xdg-open", url];
      break;
  }
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}
