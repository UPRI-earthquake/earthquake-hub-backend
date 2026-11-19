#!/usr/bin/env bash
# Read-only staging eligibility check after successful staging push CI.
# A reviewed dev -> staging merge has its original dev commit as second parent.
set -euo pipefail

: "${IMAGE:?}"
: "${GITHUB_SHA:?}"
: "${GITHUB_REPOSITORY:?}"
: "${GH_TOKEN:?}"

[[ "${GITHUB_EVENT_NAME:-}" == "push" && "${GITHUB_REF:-}" == "refs/heads/staging" ]] || {
  echo 'Automatic preflight must run on a staging push'; exit 1;
}
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid staging commit SHA'; exit 1; }
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || { echo 'Checkout does not match triggering commit'; exit 1; }

read -r -a parents <<< "$(git rev-list --parents -n 1 "$GITHUB_SHA")"
if [[ "${#parents[@]}" -ne 3 || "${parents[0]}" != "$GITHUB_SHA" ]]; then
  echo 'Expected a two-parent dev -> staging merge; cannot derive a candidate'
  exit 1
fi
SOURCE_SHA="${parents[2]}"
git merge-base --is-ancestor "$SOURCE_SHA" refs/remotes/origin/dev || {
  echo 'Merged source commit is not part of dev history'; exit 1;
}

# Resolve an existing immutable artifact; never build, retag or deploy.
EXPECTED_DIGEST="$(docker buildx imagetools inspect "${IMAGE}:sha-${SOURCE_SHA}" --format '{{.Manifest.Digest}}')"
[[ "$EXPECTED_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo 'The immutable candidate is missing or returned an invalid digest'; exit 1;
}
export SOURCE_SHA EXPECTED_DIGEST
export PROMOTION_MODE=staging DRY_RUN=true CONFIRMATION=''

# Reuse the proven manual preflight implementation.
bash .github/scripts/verify-promotion.sh

{
  echo '### Automatic staging preflight'
  echo '- Trigger: successful staging CI on push'
  printf -- '- Reviewed staging merge: `%s`\n' "$GITHUB_SHA"
  printf -- '- Resolved dev source: `%s`\n' "$SOURCE_SHA"
  printf -- '- Candidate: `%s@%s`\n' "$IMAGE" "$EXPECTED_DIGEST"
  echo '- No image tags, releases or deployed services changed'
} >> "$GITHUB_STEP_SUMMARY"
