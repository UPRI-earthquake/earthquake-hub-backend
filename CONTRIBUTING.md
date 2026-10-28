# Contributing to Earthquake Hub Backend

This guide outlines the contribution process for the Earthquake Hub backend repository.

## Setting Up The Repository On Your Local Machine

Follow the repository's current setup instructions and configuration examples. Ensure that required services and development dependencies are available.

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
