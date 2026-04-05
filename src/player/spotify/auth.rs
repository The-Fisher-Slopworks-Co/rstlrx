use anyhow::{bail, Context, Result};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize)]
pub struct SpotifyAuth {
    pub client_id: String,
    pub client_secret: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

impl SpotifyAuth {
    pub fn storage_path() -> Result<PathBuf> {
        let dir = dirs::data_local_dir()
            .context("cannot determine data directory")?
            .join("rstlrx");
        Ok(dir.join("spotify-auth.json"))
    }

    pub fn load() -> Result<Self> {
        let path = Self::storage_path()?;
        let data = std::fs::read_to_string(&path).with_context(|| {
            format!(
                "cannot read {}. Run `rstlrx login` first.",
                path.display()
            )
        })?;
        Ok(serde_json::from_str(&data)?)
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::storage_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, data)?;
        Ok(())
    }

    pub fn auth_url(client_id: &str, port: u16) -> String {
        let redirect_uri = format!("http://127.0.0.1:{port}/callback");
        let mut url = Url::parse("https://accounts.spotify.com/authorize").unwrap();
        url.query_pairs_mut()
            .append_pair("client_id", client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair(
                "scope",
                "user-read-currently-playing user-read-playback-state",
            );
        url.to_string()
    }

    pub async fn exchange_code(
        client_id: &str,
        client_secret: &str,
        code: &str,
        port: u16,
    ) -> Result<Self> {
        let redirect_uri = format!("http://127.0.0.1:{port}/callback");
        let client = reqwest::Client::new();

        let resp = client
            .post("https://accounts.spotify.com/api/token")
            .basic_auth(client_id, Some(client_secret))
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", redirect_uri.as_str()),
            ])
            .send()
            .await?;

        if !resp.status().is_success() {
            bail!(
                "spotify token exchange: {}",
                resp.text().await.unwrap_or_default()
            );
        }

        let token: TokenResponse = resp.json().await?;

        Ok(Self {
            client_id: client_id.to_string(),
            client_secret: client_secret.to_string(),
            access_token: token.access_token,
            refresh_token: token
                .refresh_token
                .context("no refresh_token in response")?,
            expires_at: now_secs() + token.expires_in,
        })
    }

    pub async fn get_token(&mut self) -> Result<&str> {
        if now_secs() + 5 >= self.expires_at {
            self.refresh().await?;
        }
        Ok(&self.access_token)
    }

    async fn refresh(&mut self) -> Result<()> {
        let client = reqwest::Client::new();

        let resp = client
            .post("https://accounts.spotify.com/api/token")
            .basic_auth(&self.client_id, Some(&self.client_secret))
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", self.refresh_token.as_str()),
            ])
            .send()
            .await?;

        if !resp.status().is_success() {
            bail!(
                "spotify refresh: {}",
                resp.text().await.unwrap_or_default()
            );
        }

        let token: TokenResponse = resp.json().await?;
        self.access_token = token.access_token;
        if let Some(rt) = token.refresh_token {
            self.refresh_token = rt;
        }
        self.expires_at = now_secs() + token.expires_in;
        self.save()?;
        Ok(())
    }

    pub async fn login_flow(client_id: &str, client_secret: &str, port: u16) -> Result<Self> {
        let url = Self::auth_url(client_id, port);
        println!("Opening browser for Spotify login...");
        open::that(&url).context("failed to open browser")?;

        let code = Self::wait_for_callback(port).await?;
        let auth = Self::exchange_code(client_id, client_secret, &code, port).await?;
        auth.save()?;
        println!("Login successful! Auth saved.");
        Ok(auth)
    }

    async fn wait_for_callback(port: u16) -> Result<String> {
        let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await?;
        println!("Waiting for callback on port {port}...");

        let (mut stream, _) = listener.accept().await?;

        let mut buf = vec![0u8; 4096];
        let n = tokio::io::AsyncReadExt::read(&mut stream, &mut buf).await?;
        let request = String::from_utf8_lossy(&buf[..n]);

        let path = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .context("malformed callback request")?;

        let url = Url::parse(&format!("http://127.0.0.1{path}"))
            .context("cannot parse callback URL")?;
        let code = url
            .query_pairs()
            .find(|(k, _)| k == "code")
            .map(|(_, v)| v.into_owned())
            .context("no auth code in callback")?;

        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
            <html><body><h1>Login successful!</h1>\
            <p>You can close this tab.</p></body></html>";
        tokio::io::AsyncWriteExt::write_all(&mut stream, response.as_bytes()).await?;

        Ok(code)
    }
}
