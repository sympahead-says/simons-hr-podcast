# Backlog — Simons HR Podcast

## Offen

## In Arbeit

## Erledigt

### Cloudflare Pages einrichten
CF Dashboard → Workers & Pages → Pages → Connect to Git.
Repo: `sympahead-says/simons-hr-podcast`, Build: `npm run build`, Output: `dist`.
Secrets: `ANTHROPIC_API_KEY` + `GCP_API_KEY` (encrypted).
Live: https://simons-hr-podcast.pages.dev (2026-04-11)

### 1Password Item anlegen
Vault "Dev Secrets privat" → Item "HR Podcast" mit API-Keys (2026-04-13).

### Alten RSS-Proxy Worker dekommissionieren
`hr-podcast-rss-proxy` Worker gelöscht, ersetzt durch Pages Function (2026-04-13).

### GitHub Pages deaktivieren
Im Repo Settings → Pages → Source auf None (2026-04-13).

### Zero Trust Access (Google Login)
Google Cloud Console: OAuth Client + Redirect URI angelegt.
Cloudflare Zero Trust: Google als Identity Provider hinterlegt, Access Application mit Policy "Allow me" (eigene Mail) erstellt.
Access Policy direkt im Pages-Projekt unter Settings aktiviert (nicht über Zero Trust Application, da `*.pages.dev` nicht auf eigener Zone läuft).
Login via Google funktioniert (2026-04-13).
