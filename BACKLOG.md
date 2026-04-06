# Backlog — Simons HR Podcast

## Offen

### Cloudflare Pages einrichten
CF Dashboard → Workers & Pages → Create → Pages → Connect to Git.
Repo: `sympahead-says/simons-hr-podcast`, Build: `npm run build`, Output: `dist`.
Secrets setzen: `ANTHROPIC_API_KEY` + `GCP_API_KEY` (encrypted).

### 1Password Item anlegen
Vault "Dev Secrets privat" → Item "HR Podcast" mit Feldern:
- `Anthropic API Key` (sk-ant-...)
- `GCP API Key` (AIza...)

### Zero Trust Access (Google Login)
1. CF Zero Trust → Authentication → Google als Identity Provider hinzufügen
2. Google Cloud Console → OAuth 2.0 Client ID → Redirect URI setzen
3. Access → Applications → Self-hosted → Pages-Domain + Policy (Allow → eigene Mail)

### Alten RSS-Proxy Worker dekommissionieren
`hr-podcast-rss-proxy` Worker im CF Dashboard löschen (ersetzt durch Pages Function).

### GitHub Pages deaktivieren
Im Repo Settings → Pages → deaktivieren (optional, schadet nicht wenn es bleibt).

## In Arbeit

## Erledigt
