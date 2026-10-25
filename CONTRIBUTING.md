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

1. Create a working branch for the intended change.
2. Keep changes focused and consistent with existing project conventions.
3. Validate the affected functionality and update relevant tests or documentation.
4. Submit a pull request to `dev`.
5. Address feedback and satisfy the applicable branch protection requirements before merging.

### Branch Protection

- Contributors follow the active GitHub branch rulesets.
- Organization admins may commit directly to `dev` when necessary.
- Changes to `staging` and `main` require pull requests, including for organization admins.
- Organization admins may bypass PR approval requirements where explicitly permitted.
- Protected branches cannot be force-pushed or deleted.

### Release Promotion and Hotfixes

Promote validated changes through `dev` → `staging` → `main` using pull requests.

For urgent production fixes, create `hotfix/*` from the verified production baseline, validate the correction, and merge it through the required release process. Propagate the fix back into active development branches.

## Contribution Guidelines

- Maintain compatibility with established interfaces and data contracts unless changes are intentional and documented.
- Follow existing code structure and testing conventions.
- Review security, data integrity, and backward-compatibility implications.
- Include relevant tests and documentation when behavior changes.
- Never commit credentials, secrets, or local configuration files.

For project-specific standards, refer to the repository's current documentation.
