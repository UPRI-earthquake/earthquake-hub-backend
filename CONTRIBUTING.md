# Contributing to Earthquake Hub Backend

This guide outlines the contribution process for the Earthquake Hub backend repository.

## Setting Up The Repository On Your Local Machine
1. Clone the repository
    
    ```bash
    git clone git@github.com:UPRI-earthquake/earthquake-hub-backend.git
    ```
2. Create a file named `.env` and set its values based on `.env.example`. You can keep most of the default values, but set your own `PG_PASSWORD` (see [POSTGRES.md, 1.1](POSTGRES.md#11-add-the-postgresql-keys-to-your-env)).
3. Install all dependencies via:
    ```bash
    npm install
    ```
4. Start the docker containers via:
    ```bash
    docker compose up
    ```
    The above command starts the backend (`earthquake-hub-backend-dev`) and PostgreSQL (`earthquake-hub-postgres`) and shows their logs. On the first run it also builds the local dev image (`earthquake-hub-backend-dev:1.0.0`); after changing the `Dockerfile`, rebuild it with `docker compose up --build`. Wait for the `earthquake-hub-backend-dev` container to log its “http://IP:PORT” before starting to code/test.
    
    Due to the local bind mount to the docker container, your changes in you the local directory should reflect to changes in the container. As such, you should be able to cycle with code-save-test without having to restart the docker containers.

    Installing npm modules should be done simply by running npm install in the local directory. This should also be reflected within the docker container due to the bind mount.
    
    See [this cheatsheet](https://upri-earthquake.github.io/docker-cheatsheet) for useful docker recipes.
5. Apply the database migrations and load the test data, from the repo root in another terminal:
    ```bash
    npm run db:pg:migrate
    npm run db:pg:seed
    ```
    Docker Compose doesn't run them for you. The migrations create the tables. The seed adds dev's 906 earthquakes and a few test accounts and sensors; the test accounts' password is `Qa-Password-2026!`. For what's in it, or to connect with a GUI client, see [POSTGRES.md](POSTGRES.md#14-load-test-data).

Refer to the repository documentation for up-to-date setup, testing, and execution commands.

## Development Workflow

### Branching Strategy

The repository follows this workflow:

`feature/*` / `fix/*` / `docs/*` / `chore/*` → `dev` → `staging` → `main`

- **Working branches:** Individual development, bug fixes, documentation, and maintenance.
- **`dev`:** Integration of ongoing development.
- **`staging`:** Validation of release candidates.
- **`main`:** Approved production-release source.
- **`hotfix/*`:** Urgent corrections based on the verified production baseline.

Create regular working branches from `dev`.

### Contributions and Pull Requests

1. Create a `feature/*`, `fix/*`, `docs/*`, or `chore/*` branch from `dev`.
2. Make focused changes and perform relevant validation.
3. Open a pull request targeting `dev` using the PR template.
4. Request a review from an eligible team member with Write access.
5. Address feedback and resolve review conversations.
6. Obtain the required approval before merging.
7. Merge after satisfying the applicable branch rules.

### Review Requirements

- Regular contributors require at least one approval.
- PR authors cannot approve their own changes.
- New commits dismiss stale approvals.
- All review conversations must be resolved before merging.
- Reviews are handled by `network-hub-development`.
- Required automated checks will be introduced separately when CI is configured.

### Branch Protection and Owner Exceptions

- `dev`, `staging`, and `main` cannot be deleted or force-pushed.
- Regular contributors must use pull requests and obtain approval.
- Organization Owners may bypass PR requirements on `dev` when necessary.
- Changes to `staging` and `main` require pull requests, including for Owners.
- Organization Owners may bypass required approvals on release PRs.
- Any bypass should include a documented reason and validation performed.


### Container Image Tagging

Frontend and Backend use the shared [GHCR image-tag policy](https://github.com/UPRI-earthquake/earthquake-hub-commons/blob/dev/docs/image-tagging.md). Automated publishing updates only `dev` and write-once `sha-COMMIT` tags. Staging and release aliases require separate approval and promotion workflows; never deploy a mutable tag without recording its image digest.

### Release Promotion and Hotfixes

- Regular development: working branch → `dev`.
- Release candidates: `dev` → `staging`.
- Approved releases: `staging` → `main`.
- Production hotfixes follow the approved release process and must be propagated back to active development branches.

For urgent production fixes, create `hotfix/*` from the verified production baseline, validate the correction, and merge it through the required release process. Propagate the fix back into active development branches.

## Contribution Guidelines

- Maintain compatibility with established interfaces and data contracts unless changes are intentional and documented.
- Follow existing code structure and testing conventions.
- Review security, data integrity, and backward-compatibility implications.
- Include relevant tests and documentation when behavior changes.
- Never commit credentials, secrets, or local configuration files.

For project-specific standards, refer to the repository's current documentation.

## Miscellaneous Notes

1. If you want to develop locally (outside of Docker) make sure you install high enough version of node and npm (the Docker image and CI use Node 22). The npm version is specially important for now to avoid altering the package-lock.json to a version that won’t be compatible to the docker image. 
2. There are test files available in the __test__/ directory, and this repo uses `jest` as test runner. `npm test` runs the unit tests; `npm run test:integration` runs the `*.integration.test.js` files against throwaway PostgreSQL containers, so it needs Docker (see [POSTGRES.md, section 4](POSTGRES.md#4-integration-tests)).
