#!/usr/bin/env bash
# Shared preflight for manual digest-only staging and versioned release promotions.
set -euo pipefail

: "${IMAGE:?}"
: "${SOURCE_SHA:?}"
: "${EXPECTED_DIGEST:?}"
: "${PROMOTION_MODE:?}"
: "${GITHUB_REPOSITORY:?}"
: "${GH_TOKEN:?}"

[[ "${GITHUB_REF}" == "refs/heads/dev" ]] || { echo "Run this workflow from dev, not ${GITHUB_REF}"; exit 1; }
[[ "${SOURCE_SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo 'Source commit must be a full lowercase 40-character SHA'; exit 1; }
[[ "${EXPECTED_DIGEST}" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Expected digest must be sha256 followed by 64 lowercase hexadecimal characters'; exit 1; }

case "${PROMOTION_MODE}" in
  staging)
    [[ "${GITHUB_REF_NAME}" == "dev" ]] || exit 1
    target_branch=staging
    confirmation="PROMOTE-STAGING"
    ;;
  release)
    target_branch=main
    confirmation="APPROVE-VERSION"
    [[ "${RELEASE_VERSION:-}" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
      echo 'Use a release version such as v1.2.3'; exit 1;
    }
    ;;
  *) echo "Unsupported promotion mode: ${PROMOTION_MODE}"; exit 1 ;;
esac

if [[ "${DRY_RUN:-true}" == 'false' && "${CONFIRMATION:-}" != "$confirmation" ]]; then
  echo "Live promotion requires confirmation: $confirmation"
  exit 1
fi

# Checkout is pinned to staging/main with fetch-depth: 0, not to caller-controlled code.
git cat-file -e "${SOURCE_SHA}^{commit}" || { echo 'Selected source commit not available'; exit 1; }
git merge-base --is-ancestor "$SOURCE_SHA" "refs/remotes/origin/$target_branch" || {
  echo "Source commit is not in the promoted $target_branch history."
  exit 1
}

# The original artifact must come from successful dev push CI.
ci_count="$(gh api -X GET "repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs" \
  -f head_sha="$SOURCE_SHA" -f event=push -f status=success -f per_page=10 \
  --jq '.total_count')"
[[ "$ci_count" =~ ^[0-9]+$ && "$ci_count" -ge 1 ]] || {
  echo "No successful dev push CI run for $SOURCE_SHA"
  exit 1
}

source_digest="$(docker buildx imagetools inspect "${IMAGE}:sha-${SOURCE_SHA}" --format '{{.Manifest.Digest}}')"
[[ "$source_digest" == "$EXPECTED_DIGEST" ]] || {
  echo "Digest mismatch: source tag resolves to $source_digest, expected $EXPECTED_DIGEST"
  exit 1
}

if [[ "$PROMOTION_MODE" == release ]]; then
  staging_digest="$(docker buildx imagetools inspect "${IMAGE}:staging" --format '{{.Manifest.Digest}}')"
  [[ "$staging_digest" == "$EXPECTED_DIGEST" ]] || {
    echo "The staging candidate changed: expected $EXPECTED_DIGEST, actual $staging_digest"
    exit 1
  }
  existing_git_tag="$(git ls-remote --tags origin "refs/tags/${RELEASE_VERSION}")"
  [[ -z "$existing_git_tag" ]] || { echo 'Git release tag already exists'; exit 1; }
  if docker buildx imagetools inspect "${IMAGE}:${RELEASE_VERSION}" >/dev/null 2>&1; then
    echo 'GHCR release tag already exists: refusing to overwrite'
    exit 1
  fi
  if gh release view "$RELEASE_VERSION" >/dev/null 2>&1; then
    echo 'GitHub Release already exists: refusing to overwrite'
    exit 1
  fi
fi

echo "Verified: $IMAGE@$EXPECTED_DIGEST"
echo "Source: $SOURCE_SHA; promoted branch: $target_branch; mode: $PROMOTION_MODE"
if [[ "${DRY_RUN:-true}" == true ]]; then
  echo "DRY RUN: no tags or GitHub Releases will be created."
fi
{
  echo "### Promotion preflight"
  echo "- Mode: `$PROMOTION_MODE`; dry-run: `${DRY_RUN:-true}`"
  echo "- Source commit: `$SOURCE_SHA` (passed dev push CI)"
  echo "- Verified artifact: `$IMAGE@$EXPECTED_DIGEST`"
  echo "- Verified branch: `$target_branch`"
} >> "$GITHUB_STEP_SUMMARY"
