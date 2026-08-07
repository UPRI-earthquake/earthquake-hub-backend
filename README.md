# earthquake-hub-backend
earthquake-hub-backend program is the server-side component of the EarthquakeHub web application. For more details, you may refer to the [repository overview and API](https://upri-earthquake.github.io).  

## Development Setup
To run this repository on your local machine, please follow the instructions provided under the [Setting Up The Repository On Your Local Machine](CONTRIBUTING.md#setting-up-the-repository-on-your-local-machine) section of the [contributing.md](CONTRIBUTING.md)

## Admin Console control plane

The browser-facing Admin Console API, authorization, application workflows,
persistence, jobs, and audit policy live in this repository. Start with:

- [Admin control-plane developer guide](docs/admin-control-plane.md)
- [Admin action capability policy](docs/admin-action-capabilities.md)
- [Station operational-history contract](docs/station-operational-history.md)

The separate `earthquake-hub-admin-backend` is a private read-only telemetry
adapter. It is not a second browser API and must never be proxied through public
nginx.

## Email Branding
Outgoing HTML emails (device alerts and password-reset emails) support logo branding through environment variables:
- `EMAIL_LOGO_URL`: remote URL for the logo (preferred for production email clients)
- `EMAIL_LOGO_PATH`: direct path to an image file
- `EMAIL_LOGO_PUBLIC_FILE`: file name under `earthquake-hub-frontend/public` (for monorepo local/dev setup)
- `EMAIL_FRONTEND_PUBLIC_DIR`: optional override of the frontend public directory path

## Reverse Tunnel Enrollment API

Server-managed remote tunnel enrollment endpoints are exposed under `/device/tunnel/*`:
- `POST /device/tunnel/enroll` (sensor bearer token required)
- `GET /device/tunnel/mappings` (admin cookie session required)
- `POST /device/tunnel/revoke` (admin cookie session required)

These endpoints call server-owned bastion scripts configured via:
- `TUNNEL_REGISTER_SCRIPT`
- `TUNNEL_REVOKE_SCRIPT`
- `TUNNEL_REGISTRY_FILE`
- `TUNNEL_BASTION_HOST`
- `TUNNEL_WSS_URL` (optional; returned to sender enrollment clients)
- `TUNNEL_WSS_PATH_PREFIX` (optional; returned to sender enrollment clients)

For containerized deployments, prefer SSH execution mode so scripts run on the bastion host (not inside the app container):
- `TUNNEL_SCRIPT_EXEC_MODE=ssh`
- `TUNNEL_SCRIPT_SSH_HOST`
- `TUNNEL_SCRIPT_SSH_PORT`
- `TUNNEL_SCRIPT_SSH_USER`
- `TUNNEL_SCRIPT_SSH_KEY_PATH`
- `TUNNEL_SCRIPT_SSH_KNOWN_HOSTS_PATH`
- `TUNNEL_SCRIPT_SSH_STRICT_HOST_KEY`
- `TUNNEL_SCRIPT_SSH_REMOTE_PREFIX` (default: `sudo -n`)
