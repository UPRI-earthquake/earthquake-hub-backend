# earthquake-hub-backend
earthquake-hub-backend program is the server-side component of the EarthquakeHub web application. For more details, you may refer to the [repository overview and API](https://upri-earthquake.github.io).  

## Development Setup
To run this repository on your local machine, please follow the instructions provided under the [Setting Up The Repository On Your Local Machine](CONTRIBUTING.md#setting-up-the-repository-on-your-local-machine) section of the [contributing.md](CONTRIBUTING.md)

## Reverse Tunnel Enrollment API

Server-managed reverse SSH enrollment endpoints are exposed under `/device/tunnel/*`:
- `POST /device/tunnel/enroll` (sensor bearer token required)
- `GET /device/tunnel/mappings` (admin cookie session required)
- `POST /device/tunnel/revoke` (admin cookie session required)

These endpoints call server-owned bastion scripts configured via:
- `TUNNEL_REGISTER_SCRIPT`
- `TUNNEL_REVOKE_SCRIPT`
- `TUNNEL_REGISTRY_FILE`
- `TUNNEL_BASTION_HOST`
